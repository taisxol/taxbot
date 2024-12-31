const express = require('express');
const cors = require('cors');
const path = require('path');
const { Connection, PublicKey, clusterApiUrl } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

// Configure CORS for specific origins
app.use(cors({
    origin: ['https://taxbot.onrender.com', 'http://localhost:3000'],
    methods: ['GET', 'POST'],
    credentials: true
}));

app.use(express.json());

// Initialize Solana connection with better error handling
let connection;
try {
    connection = new Connection(
        process.env.SOLANA_RPC_URL || clusterApiUrl('mainnet-beta'),
        'confirmed'
    );
    console.log('Solana connection initialized');
} catch (error) {
    console.error('Failed to initialize Solana connection:', error);
}

// Serve static files from the React app in production
if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, '../client/build')));
}

// Health check endpoint with connection status
app.get('/health', (req, res) => {
    try {
        res.json({
            status: 'ok',
            environment: process.env.NODE_ENV,
            rpcEndpoint: connection?.rpcEndpoint || 'not connected'
        });
    } catch (error) {
        console.error('Health check error:', error);
        res.status(500).json({ error: 'Health check failed' });
    }
});

// API endpoints with better error handling
app.get('/api/transactions/:walletAddress', async (req, res) => {
    try {
        console.log('Fetching transactions for wallet:', req.params.walletAddress);
        
        if (!connection) {
            throw new Error('Solana connection not initialized');
        }

        const walletAddress = new PublicKey(req.params.walletAddress);
        
        // Get token accounts
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(walletAddress, {
            programId: TOKEN_PROGRAM_ID
        });

        // Process token accounts
        const processedTokenAccounts = tokenAccounts.value.map(account => {
            const tokenData = account.account.data.parsed.info;
            const amount = tokenData.tokenAmount.uiAmount || 0;
            // Only include tokens with non-zero balance
            if (amount > 0) {
                return {
                    mint: tokenData.mint,
                    amount: amount,
                    decimals: tokenData.tokenAmount.decimals,
                    usdValue: amount * 1 // TODO: Get actual token price
                };
            }
            return null;
        }).filter(token => token !== null);

        let totalTokenValue = processedTokenAccounts.reduce((sum, token) => sum + token.usdValue, 0);
        
        // Get recent transactions
        const signatures = await connection.getSignaturesForAddress(walletAddress, {
            limit: 20
        });
        
        console.log(`Found ${signatures.length} transactions`);
        
        let totalIncome = 0;
        let capitalGains = 0;
        let totalFees = 0;
        
        const transactions = await Promise.all(
            signatures.map(async (sig) => {
                try {
                    const tx = await connection.getTransaction(sig.signature, {
                        maxSupportedTransactionVersion: 0
                    });
                    
                    if (!tx) return null;

                    // Calculate fees
                    const fee = tx.meta?.fee || 0;
                    totalFees += fee / 1e9; // Convert lamports to SOL
                    
                    // Determine transaction type and calculate values
                    let type = 'TRANSFER';
                    let inTokens = [];
                    let outTokens = [];
                    
                    if (tx.meta?.preTokenBalances && tx.meta?.postTokenBalances) {
                        const preBalances = tx.meta.preTokenBalances;
                        const postBalances = tx.meta.postTokenBalances;
                        
                        // Calculate token transfers
                        for (let i = 0; i < postBalances.length; i++) {
                            const post = postBalances[i];
                            const pre = preBalances.find(b => b.accountIndex === post.accountIndex);
                            
                            if (pre && post) {
                                const diff = (post.uiTokenAmount.uiAmount || 0) - (pre.uiTokenAmount.uiAmount || 0);
                                if (diff > 0) {
                                    inTokens.push({
                                        mint: post.mint,
                                        amount: diff,
                                        usdValue: diff * 1 // TODO: Get actual token price
                                    });
                                    totalIncome += diff * 1;
                                } else if (diff < 0) {
                                    outTokens.push({
                                        mint: post.mint,
                                        amount: Math.abs(diff),
                                        usdValue: Math.abs(diff) * 1
                                    });
                                }
                            }
                        }
                        
                        if (inTokens.length > 0 && outTokens.length > 0) {
                            type = 'SWAP';
                            // Calculate profit/loss
                            const inValue = inTokens.reduce((sum, t) => sum + (t.usdValue || 0), 0);
                            const outValue = outTokens.reduce((sum, t) => sum + (t.usdValue || 0), 0);
                            const profit = inValue - outValue;
                            capitalGains += profit;
                            return {
                                signature: sig.signature,
                                timestamp: sig.blockTime,
                                type,
                                inTokens,
                                outTokens,
                                fee,
                                profit,
                                status: 'confirmed'
                            };
                        }
                    }
                    
                    return {
                        signature: sig.signature,
                        timestamp: sig.blockTime,
                        type,
                        inTokens,
                        outTokens,
                        fee,
                        status: 'confirmed'
                    };
                } catch (err) {
                    console.error('Error fetching transaction:', sig.signature, err);
                    return null;
                }
            })
        );

        // Filter out null transactions
        const validTransactions = transactions.filter(tx => tx !== null);
        
        // Get SOL balance
        const balance = await connection.getBalance(walletAddress);
        const balanceInSol = balance / 1e9;
        const solPrice = 1; // TODO: Get actual SOL price
        const balanceUSD = balanceInSol * solPrice;

        res.json({
            walletAddress: req.params.walletAddress,
            balance: balanceInSol,
            balanceUSD: balanceUSD,
            tokenAccounts: processedTokenAccounts,
            tokenBalanceUSD: totalTokenValue,
            transactions: validTransactions,
            taxSummary: {
                totalIncome,
                capitalGains,
                totalFees,
                taxLiability: totalIncome * 0.37 + capitalGains * 0.20
            }
        });
        
    } catch (error) {
        console.error('API error:', error);
        res.status(500).json({
            error: 'Failed to fetch wallet data',
            details: error.message
        });
    }
});

// Catch-all route to serve React app
if (process.env.NODE_ENV === 'production') {
    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, '../client/build/index.html'));
    });
}

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`Environment: ${process.env.NODE_ENV}`);
    console.log(`Using RPC endpoint: ${process.env.SOLANA_RPC_URL || 'default mainnet-beta'}`);
});
