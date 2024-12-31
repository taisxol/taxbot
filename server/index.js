const express = require('express');
const cors = require('cors');
const path = require('path');
const { Connection, PublicKey, clusterApiUrl, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const axios = require('axios');
const CoinGecko = require('coingecko-api');

const app = express();
const port = process.env.PORT || 5000;

// Enable CORS for all origins
app.use(cors());
app.use(express.json());

// Initialize Solana connection
const connection = new Connection('https://api.mainnet-beta.solana.com');

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

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/transactions/:address', async (req, res) => {
  try {
    const { address } = req.params;
    console.log('Fetching transactions for address:', address);
    
    if (!connection) {
      throw new Error('Solana connection not initialized');
    }

    const walletAddress = new PublicKey(address);
    
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
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// Serve static files from the React app in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build')));
}

// API routes should be before the catch-all route
app.get('/api/*', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
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
  console.error(err.stack);
  res.status(500).json({
    error: 'Something broke!',
    message: err.message
  });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
});
