const express = require('express');
const cors = require('cors');
const path = require('path');
const { Connection, PublicKey, clusterApiUrl, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const axios = require('axios');
const CoinGecko = require('coingecko-api');

const app = express();
const port = process.env.PORT || 5000;

// Enable CORS for all origins in production
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// Initialize Solana connection
const connection = new Connection(
  'https://api.mainnet-beta.solana.com',
  'confirmed'
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
        
        // Get SOL balance
        const balance = await connection.getBalance(walletAddress);
        console.log('Raw balance:', balance);
        const solBalance = balance / LAMPORTS_PER_SOL;
        console.log('SOL balance:', solBalance);
        
        // Get token accounts
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(walletAddress, {
            programId: TOKEN_PROGRAM_ID
        });

        console.log('Token accounts found:', tokenAccounts.value.length);

        // Process token accounts - only get the mint addresses
        const tokens = tokenAccounts.value.map(account => ({
            mint: account.account.data.parsed.info.mint
        }));

        console.log('Processed tokens:', tokens);

        res.json({
            solBalance,
            tokens
        });
        
    } catch (error) {
        console.error('API error:', error);
        res.status(500).json({
            error: 'Failed to fetch wallet data',
            details: error.message
        });
    }
});

// Handle React routing in production
app.get('*', (req, res) => {
    if (process.env.NODE_ENV === 'production') {
        res.sendFile(path.join(__dirname, '../client/build/index.html'));
    } else {
        res.status(404).send('Not Found');
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server is running on port ${port}`);
});
