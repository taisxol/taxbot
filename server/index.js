const express = require('express');
const cors = require('cors');
const path = require('path');
const { Connection, PublicKey, clusterApiUrl } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const axios = require('axios');
const CoinGecko = require('coingecko-api');

const app = express();
const PORT = 5000;

// CORS configuration - allow all origins in development
app.use(cors());

app.use(express.json());

// Initialize connection with higher commitment and better timeout
const connection = new Connection(
    'https://api.mainnet-beta.solana.com',
    {
        commitment: 'confirmed',
        confirmTransactionInitialTimeout: 60000,
        wsEndpoint: 'wss://api.mainnet-beta.solana.com/'
    }
);
console.log('Solana connection initialized');

// Initialize CoinGecko
const CoinGeckoClient = new CoinGecko();

// Cache token prices for 5 minutes
const tokenPriceCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Token address to CoinGecko ID mapping
const tokenMapping = {
    'So11111111111111111111111111111111111111112': 'solana', // Native SOL
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'usd-coin', // USDC
    // Add more mappings as needed
};

async function getTokenPrice(mint) {
    const now = Date.now();
    const cached = tokenPriceCache.get(mint);
    if (cached && now - cached.timestamp < CACHE_DURATION) {
        return cached.price;
    }

    try {
        const coingeckoId = tokenMapping[mint];
        if (!coingeckoId) {
            throw new Error(`No CoinGecko ID found for token ${mint}`);
        }

        const response = await CoinGeckoClient.coins.fetchMarketData(coingeckoId);
        const price = response.data.market_data.current_price.usd;

        tokenPriceCache.set(mint, {
            price: price,
            timestamp: now
        });
        return price;
    } catch (error) {
        console.error(`Error fetching price for token ${mint}:`, error);
        return 0;
    }
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

        // Process token accounts and fetch prices
        const processedTokenAccounts = await Promise.all(tokenAccounts.value.map(async account => {
            const tokenData = account.account.data.parsed.info;
            const amount = tokenData.tokenAmount.uiAmount || 0;
            
            if (amount > 0) {
                const price = await getTokenPrice(tokenData.mint);
                const usdValue = amount * price;
                
                return {
                    mint: tokenData.mint,
                    amount: amount,
                    decimals: tokenData.tokenAmount.decimals,
                    usdValue: usdValue
                };
            }
            return null;
        }));

        const validTokenAccounts = processedTokenAccounts.filter(token => token !== null);
        let totalTokenValue = validTokenAccounts.reduce((sum, token) => sum + token.usdValue, 0);
        
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
                                        usdValue: diff * (await getTokenPrice(post.mint))
                                    });
                                    totalIncome += diff * (await getTokenPrice(post.mint));
                                } else if (diff < 0) {
                                    outTokens.push({
                                        mint: post.mint,
                                        amount: Math.abs(diff),
                                        usdValue: Math.abs(diff) * (await getTokenPrice(post.mint))
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
        const solPrice = await getTokenPrice('So11111111111111111111111111111111111111112'); // Native SOL mint
        const balanceUSD = balanceInSol * solPrice;

        res.json({
            walletAddress: req.params.walletAddress,
            balance: balanceInSol,
            balanceUSD: balanceUSD,
            tokenAccounts: validTokenAccounts,
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

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
