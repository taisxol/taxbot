const express = require('express');
const cors = require('cors');
const path = require('path');
const { Connection, PublicKey, clusterApiUrl } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

// Configure CORS - allow all origins in production for now
app.use(cors());

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
        
        // Get recent transactions
        const signatures = await connection.getSignaturesForAddress(walletAddress, {
            limit: 20
        });
        
        console.log(`Found ${signatures.length} transactions`);
        
        const transactions = await Promise.all(
            signatures.map(async (sig) => {
                try {
                    const tx = await connection.getTransaction(sig.signature);
                    return {
                        signature: sig.signature,
                        timestamp: sig.blockTime,
                        status: tx ? 'confirmed' : 'failed'
                    };
                } catch (err) {
                    console.error('Error fetching transaction:', sig.signature, err);
                    return {
                        signature: sig.signature,
                        timestamp: sig.blockTime,
                        status: 'error',
                        error: err.message
                    };
                }
            })
        );

        res.json({
            walletAddress: req.params.walletAddress,
            transactions: transactions
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
