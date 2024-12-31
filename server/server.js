const express = require('express');
const cors = require('cors');
const { Connection, PublicKey, clusterApiUrl } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID } = require('@solana/spl-token');

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Utility function to delay execution
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Initialize Solana connection with retry logic
let connection = null;
const MAX_RETRIES = 3;

async function initializeSolanaConnection() {
    let retries = 0;
    while (retries < MAX_RETRIES) {
        try {
            console.log(`Attempting to connect to Solana (attempt ${retries + 1}/${MAX_RETRIES})...`);
            connection = new Connection(
                clusterApiUrl('mainnet-beta'),
                {
                    commitment: 'confirmed',
                    confirmTransactionInitialTimeout: 60000,
                    wsEndpoint: undefined // Disable WebSocket
                }
            );
            
            // Test the connection
            const slot = await connection.getSlot();
            console.log('Successfully connected to Solana network, current slot:', slot);
            return true;
        } catch (error) {
            console.error(`Failed to connect to Solana (attempt ${retries + 1}):`, error);
            retries++;
            if (retries < MAX_RETRIES) {
                await sleep(2000 * retries); // Exponential backoff
            }
        }
    }
    return false;
}

// Initialize connection immediately
initializeSolanaConnection().then(success => {
    if (!success) {
        console.error('Failed to initialize Solana connection after multiple retries');
    }
});

// API endpoint
app.get('/api/transactions/:walletAddress', async (req, res) => {
    try {
        const walletAddress = req.params.walletAddress;
        console.log('\n=== Starting wallet analysis ===');
        console.log('Wallet address:', walletAddress);
        
        // Validate input
        if (!walletAddress || walletAddress.trim().length === 0) {
            console.error('Empty wallet address');
            return res.status(400).json({
                error: 'Please enter a wallet address'
            });
        }

        // Check connection and try to reconnect if needed
        if (!connection) {
            console.log('No connection, attempting to reconnect...');
            const success = await initializeSolanaConnection();
            if (!success) {
                return res.status(503).json({
                    error: 'Unable to connect to Solana network'
                });
            }
        }

        // Test connection before proceeding
        try {
            await connection.getSlot();
        } catch (error) {
            console.error('Connection test failed, attempting to reconnect...');
            const success = await initializeSolanaConnection();
            if (!success) {
                return res.status(503).json({
                    error: 'Unable to connect to Solana network'
                });
            }
        }

        // Validate wallet address
        let pubKey;
        try {
            pubKey = new PublicKey(walletAddress);
            console.log('Created PublicKey:', pubKey.toString());
            
            if (!PublicKey.isOnCurve(pubKey.toBytes())) {
                console.error('Address is not on curve');
                return res.status(400).json({
                    error: 'Invalid wallet address format'
                });
            }
            console.log('Validated wallet address (on curve)');
        } catch (error) {
            console.error('Invalid wallet address:', error);
            return res.status(400).json({
                error: 'Invalid wallet address format'
            });
        }

        // Get SOL balance with retry
        let balance;
        let balanceRetries = 0;
        while (balanceRetries < MAX_RETRIES) {
            try {
                console.log(`Fetching SOL balance (attempt ${balanceRetries + 1})...`);
                balance = await connection.getBalance(pubKey);
                console.log('Raw balance:', balance);
                break;
            } catch (error) {
                console.error(`Error fetching SOL balance (attempt ${balanceRetries + 1}):`, error);
                balanceRetries++;
                if (balanceRetries === MAX_RETRIES) {
                    return res.status(500).json({
                        error: 'Failed to fetch SOL balance'
                    });
                }
                await sleep(1000 * balanceRetries);
            }
        }

        const balanceInSol = balance / 1e9;
        console.log('Balance in SOL:', balanceInSol);

        // Calculate year P&L
        console.log('\nCalculating year P&L...');
        let yearSummary;
        try {
            yearSummary = await calculateYearPL(walletAddress);
            console.log('Year summary calculated:', JSON.stringify(yearSummary, null, 2));
            
            if (!yearSummary || typeof yearSummary !== 'object') {
                throw new Error('Invalid year summary data');
            }
        } catch (error) {
            console.error('Error calculating P&L:', error);
            return res.status(500).json({
                error: error.message || 'Failed to calculate P&L'
            });
        }

        // Format response to match client expectations
        const responseData = {
            walletAddress: walletAddress,
            balance: parseFloat(balanceInSol.toFixed(9)),
            totalValue: yearSummary.totalValue,
            transactions: yearSummary.transactions,
            balanceUSD: 0, // Placeholder for future price integration
            tokenAccounts: [], // Placeholder for token accounts
            tokenBalanceUSD: 0 // Placeholder for token balance in USD
        };

        console.log('\nSending response:', JSON.stringify(responseData, null, 2));
        return res.json(responseData);
    } catch (error) {
        console.error('\nUnexpected error:', error);
        return res.status(500).json({
            error: 'An unexpected error occurred'
        });
    }
});

// Calculate transaction value from a Solana transaction
function calculateTransactionValue(tx) {
    let value = 0;

    try {
        // Calculate SOL transfer value
        if (tx.meta && Array.isArray(tx.meta.preBalances) && Array.isArray(tx.meta.postBalances)) {
            // Find the sender's index (usually the first account that has a balance decrease)
            const senderIndex = tx.meta.preBalances.findIndex((pre, idx) => {
                const post = tx.meta.postBalances[idx];
                return pre > post;
            });

            if (senderIndex !== -1) {
                const preSenderBalance = tx.meta.preBalances[senderIndex];
                const postSenderBalance = tx.meta.postBalances[senderIndex];
                const solTransfer = Math.abs(postSenderBalance - preSenderBalance) / 1e9;
                value += solTransfer;
                console.log('SOL transfer value:', solTransfer);
            }
        }

        // Calculate token transfer values
        if (tx.meta?.preTokenBalances && tx.meta?.postTokenBalances) {
            const preBalances = new Map(tx.meta.preTokenBalances.map(b => [b.accountIndex, b]));
            const postBalances = new Map(tx.meta.postTokenBalances.map(b => [b.accountIndex, b]));

            for (const [index, pre] of preBalances) {
                const post = postBalances.get(index);
                if (post && pre.mint === post.mint) {
                    const preAmount = pre.uiTokenAmount?.uiAmount || 0;
                    const postAmount = post.uiTokenAmount?.uiAmount || 0;
                    if (preAmount !== postAmount) {
                        const diff = Math.abs(postAmount - preAmount);
                        value += diff;
                        console.log('Token transfer value:', diff, 'for mint:', pre.mint);
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error calculating transaction value:', error);
    }

    return value;
}

// Calculate year-to-date P&L with better error handling
async function calculateYearPL(walletAddress) {
    try {
        console.log('Starting year P&L calculation for:', walletAddress);
        const currentYear = new Date().getFullYear();
        const startOfYear = new Date(currentYear, 0, 1).getTime() / 1000;
        
        // Get all signatures for the year with pagination
        let signatures = [];
        let before = undefined;
        let retries = 0;
        
        // Create PublicKey object once
        const pubKey = new PublicKey(walletAddress);
        console.log('Created PublicKey:', pubKey.toString());
        
        while (retries < MAX_RETRIES) {
            try {
                console.log(`Fetching signature batch (attempt ${retries + 1})...`);
                
                // Test connection before fetching
                await connection.getSlot();
                
                const batch = await connection.getSignaturesForAddress(
                    pubKey,
                    { 
                        before, 
                        limit: 25,
                        commitment: 'confirmed'
                    }
                );
                
                if (!batch) {
                    throw new Error('No response from Solana API');
                }
                
                if (!Array.isArray(batch)) {
                    console.error('Invalid batch type:', typeof batch);
                    throw new Error('Invalid response format from Solana API');
                }
                
                console.log(`Found ${batch.length} total transactions`);
                
                // Filter transactions from this year
                signatures = batch.filter(tx => {
                    if (!tx || !tx.blockTime) {
                        console.log('Invalid transaction in batch:', tx);
                        return false;
                    }
                    return tx.blockTime >= startOfYear;
                });
                
                console.log(`Found ${signatures.length} transactions from ${currentYear}`);
                break;
            } catch (error) {
                console.error(`Error fetching signatures (attempt ${retries + 1}):`, error);
                retries++;
                if (retries === MAX_RETRIES) {
                    throw new Error(`Failed to fetch transactions: ${error.message}`);
                }
                await sleep(1000 * retries);
            }
        }

        if (signatures.length === 0) {
            console.log('No transactions found for this year');
            return {
                year: currentYear,
                trades: 0,
                totalValue: 0,
                transactions: []
            };
        }

        console.log(`Processing ${signatures.length} transactions...`);
        const transactions = [];
        let failedTransactions = 0;
        
        for (const sig of signatures) {
            try {
                await sleep(100); // Rate limiting
                console.log('Processing transaction:', sig.signature);
                
                const tx = await connection.getTransaction(sig.signature, {
                    maxSupportedTransactionVersion: 0,
                    commitment: 'confirmed'
                });
                
                if (!tx) {
                    console.log('Transaction not found:', sig.signature);
                    failedTransactions++;
                    continue;
                }
                
                const timestamp = sig.blockTime;
                const value = calculateTransactionValue(tx);
                
                const transaction = {
                    signature: sig.signature,
                    timestamp,
                    value: parseFloat(value.toFixed(4))
                };
                
                console.log('Processed transaction:', transaction);
                transactions.push(transaction);
                
            } catch (error) {
                console.error('Error processing transaction:', sig.signature, error);
                failedTransactions++;
                continue;
            }
        }

        if (transactions.length === 0 && failedTransactions > 0) {
            throw new Error('Failed to process any transactions successfully');
        }

        const totalValue = transactions.reduce((sum, tx) => sum + tx.value, 0);
        const yearSummary = {
            year: currentYear,
            trades: transactions.length,
            totalValue: parseFloat(totalValue.toFixed(2)),
            transactions: transactions.sort((a, b) => b.timestamp - a.timestamp).slice(0, 10) // Only return latest 10 transactions
        };

        console.log('Year summary calculated:', JSON.stringify(yearSummary, null, 2));
        if (failedTransactions > 0) {
            console.log(`Note: ${failedTransactions} transactions failed to process`);
        }
        return yearSummary;
    } catch (error) {
        console.error('Error calculating year P&L:', error);
        throw new Error(`Failed to calculate wallet data: ${error.message}`);
    }
}

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
