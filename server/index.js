const express = require('express');
const cors = require('cors');
const path = require('path');
const { Connection, PublicKey, clusterApiUrl } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

// Known DEX program IDs
const DEX_PROGRAMS = {
    RAYDIUM: 'RaydiumV2',
    ORCA: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
    JUPITER: 'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB'
};

// Configure CORS for all environments
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? 'https://taxbot.onrender.com'
    : 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Serve static files from the React app in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build')));
}

// Initialize Solana connection
const connection = new Connection(
    process.env.SOLANA_RPC_URL,  // Use RPC URL from environment variables
    {
        commitment: 'confirmed',
        confirmTransactionInitialTimeout: 60000,
        wsEndpoint: undefined
    }
);

// Cache for token prices
const tokenPriceCache = new Map();

// Cache for token metadata
const tokenMetadataCache = new Map();
let jupiterTokenList = null;

async function loadJupiterTokenList() {
    try {
        if (!jupiterTokenList) {
            console.log('Loading Jupiter token list...');
            const response = await axios.get('https://token.jup.ag/all');
            jupiterTokenList = response.data;
            console.log(`Loaded ${jupiterTokenList.length} tokens from Jupiter`);
        }
        return jupiterTokenList;
    } catch (error) {
        console.error('Error loading Jupiter token list:', error.message);
        return [];
    }
}

async function getTokenMetadata(mintAddress) {
    if (tokenMetadataCache.has(mintAddress)) {
        return tokenMetadataCache.get(mintAddress);
    }

    try {
        console.log(`Fetching metadata for token: ${mintAddress}`);
        
        // Load Jupiter token list if not loaded
        const tokens = await loadJupiterTokenList();
        
        // Try to find token in Jupiter list
        const token = tokens.find(t => t.address.toLowerCase() === mintAddress.toLowerCase());
        
        if (token) {
            console.log(`Found token metadata: ${token.symbol}`);
            const metadata = {
                symbol: token.symbol,
                name: token.name,
                decimals: token.decimals
            };
            tokenMetadataCache.set(mintAddress, metadata);
            return metadata;
        }

        // If not found in Jupiter list, try to get on-chain metadata
        try {
            console.log('Fetching on-chain metadata...');
            const info = await connection.getParsedAccountInfo(new PublicKey(mintAddress));
            if (info?.value?.data?.parsed?.info) {
                const { symbol, name, decimals } = info.value.data.parsed.info;
                if (symbol) {
                    console.log(`Found on-chain metadata: ${symbol}`);
                    const metadata = {
                        symbol: symbol || mintAddress.slice(0, 8),
                        name: name || symbol,
                        decimals: decimals || 9
                    };
                    tokenMetadataCache.set(mintAddress, metadata);
                    return metadata;
                }
            }
        } catch (e) {
            console.log('Failed to fetch on-chain metadata:', e.message);
        }
        
        // If all else fails, return a shortened address
        console.log(`No metadata found for token: ${mintAddress}`);
        return {
            symbol: mintAddress.slice(0, 8) + '...',
            name: 'Unknown Token',
            decimals: 9
        };
    } catch (error) {
        console.error('Error fetching token metadata:', error.message);
        return {
            symbol: mintAddress.slice(0, 8) + '...',
            name: 'Unknown Token',
            decimals: 9
        };
    }
}

async function getTokenPrice(mintAddress, timestamp) {
    const cacheKey = `${mintAddress}-${timestamp}`;
    if (tokenPriceCache.has(cacheKey)) {
        return tokenPriceCache.get(cacheKey);
    }

    try {
        // Use CoinGecko's historical price API
        const response = await axios.get(
            `https://api.coingecko.com/api/v3/simple/token_price/solana?contract_addresses=${mintAddress}&vs_currencies=usd&include_24hr_change=true`
        );
        const price = response.data[mintAddress.toLowerCase()]?.usd || 0;
        tokenPriceCache.set(cacheKey, price);
        return price;
    } catch (error) {
        console.error('Error fetching token price:', error);
        return 0;
    }
}

async function getTokenAccountsByOwner(walletAddress) {
    try {
        console.log('Fetching token accounts for wallet:', walletAddress);
        const publicKey = new PublicKey(walletAddress);
        const accounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
            programId: TOKEN_PROGRAM_ID,
        });

        console.log(`Found ${accounts.value.length} token accounts`);
        
        const tokenAccounts = await Promise.all(accounts.value.map(async (account) => {
            const { mint, tokenAmount } = account.account.data.parsed.info;
            console.log(`Processing token account with mint: ${mint}`);
            
            // Only fetch metadata for tokens with non-zero balance
            if (parseFloat(tokenAmount.uiAmount) > 0) {
                const metadata = await getTokenMetadata(mint);
                return {
                    mint,
                    symbol: metadata.symbol,
                    name: metadata.name,
                    amount: tokenAmount.amount,
                    decimals: tokenAmount.decimals,
                    uiAmount: tokenAmount.uiAmount
                };
            }
            return null;
        }));

        // Filter out null values (zero balance tokens) and sort by UI amount
        return tokenAccounts
            .filter(account => account !== null)
            .sort((a, b) => b.uiAmount - a.uiAmount);
    } catch (error) {
        console.error('Error fetching token accounts:', error);
        return [];
    }
}

async function analyzeTransaction(tx, walletAddress, solPrice) {
    const result = {
        type: 'UNKNOWN',
        description: '',
        inTokens: [],
        outTokens: [],
        fees: 0,
        profit: 0,
        timestamp: tx.blockTime
    };

    try {
        const accountKeys = tx.transaction.message.accountKeys.map(key => key.toBase58());
        const instructions = tx.transaction.message.instructions;
        const preBalances = tx.meta?.preBalances || [];
        const postBalances = tx.meta?.postBalances || [];
        const preTokenBalances = tx.meta?.preTokenBalances || [];
        const postTokenBalances = tx.meta?.postTokenBalances || [];

        // Check if this is a DEX swap
        const isDex = instructions.some(ix => 
            Object.values(DEX_PROGRAMS).includes(ix.programId?.toBase58())
        );

        if (isDex) {
            result.type = 'SWAP';
            
            // Analyze token balance changes
            for (const [pre, post] of zip(preTokenBalances, postTokenBalances)) {
                if (!pre || !post) continue;
                
                const balanceChange = (post.uiTokenAmount.uiAmount || 0) - (pre.uiTokenAmount.uiAmount || 0);
                const tokenPrice = await getTokenPrice(post.mint, tx.blockTime);
                const usdValue = Math.abs(balanceChange * tokenPrice);

                if (balanceChange > 0) {
                    result.inTokens.push({
                        mint: post.mint,
                        amount: balanceChange,
                        usdValue
                    });
                } else if (balanceChange < 0) {
                    result.outTokens.push({
                        mint: post.mint,
                        amount: Math.abs(balanceChange),
                        usdValue
                    });
                }
            }

            // Calculate profit/loss
            const totalIn = result.inTokens.reduce((sum, token) => sum + token.usdValue, 0);
            const totalOut = result.outTokens.reduce((sum, token) => sum + token.usdValue, 0);
            result.profit = totalIn - totalOut;
        }

        // Check for token transfers
        else if (preTokenBalances.length > 0 || postTokenBalances.length > 0) {
            result.type = 'TRANSFER';
            // Similar token balance analysis as above
        }

        // Check for SOL transfers
        else {
            const walletIndex = accountKeys.indexOf(walletAddress);
            if (walletIndex !== -1) {
                const solChange = (postBalances[walletIndex] - preBalances[walletIndex]) / 1e9;
                if (Math.abs(solChange) > 0) {
                    result.type = 'SOL_TRANSFER';
                    const usdValue = Math.abs(solChange * solPrice);
                    if (solChange > 0) {
                        result.inTokens.push({
                            mint: 'SOL',
                            amount: solChange,
                            usdValue
                        });
                    } else {
                        result.outTokens.push({
                            mint: 'SOL',
                            amount: Math.abs(solChange),
                            usdValue
                        });
                    }
                }
            }
        }

        // Calculate transaction fee
        const feeIndex = tx.meta?.fee ? accountKeys.indexOf(walletAddress) : -1;
        if (feeIndex !== -1) {
            result.fees = tx.meta.fee / 1e9;
        }

    } catch (error) {
        console.error('Error analyzing transaction:', error);
    }

    return result;
}

function zip(a, b) {
    return a.map((k, i) => [k, b[i]]);
}

// API endpoint to fetch wallet transactions
app.get('/api/transactions/:address', async (req, res) => {
    console.log('\n--- New Request ---');
    const startTime = Date.now();
    
    try {
        const { address } = req.params;
        console.log(`[${Date.now() - startTime}ms] Processing address:`, address);

        // Validate the address
        let publicKey;
        try {
            publicKey = new PublicKey(address);
        } catch (err) {
            console.error(`Invalid address:`, err);
            return res.status(400).json({ 
                error: 'Invalid Solana address',
                details: err.message
            });
        }

        // Get SOL balance and price
        const [balance, solPriceResponse] = await Promise.all([
            connection.getBalance(publicKey),
            axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd')
        ]);
        const solPrice = solPriceResponse.data.solana.usd;

        // Get token accounts
        const tokenAccounts = await getTokenAccountsByOwner(address);

        // Process transactions
        const signatures = await connection.getSignaturesForAddress(publicKey, { limit: 20 });
        const transactions = [];
        
        for (const sig of signatures) {
          try {
            const tx = await connection.getParsedTransaction(sig.signature, {
              maxSupportedTransactionVersion: 0
            });

            if (!tx) continue;

            const timestamp = tx.blockTime || Date.now() / 1000;
            let type = 'TRANSFER';
            let inTokens = [];
            let outTokens = [];
            let fees = tx.meta.fee / 1e9;
            let profit = 0;

            // Check if this is a swap transaction
            const isSwap = tx.meta?.innerInstructions?.some(ix => 
              ix.instructions.some(i => i.program === 'spl-token' && i.parsed?.type === 'transfer')
            );

            if (isSwap) {
              type = 'SWAP';
              // Process swap details
              const preBalances = tx.meta.preBalances;
              const postBalances = tx.meta.postBalances;
              const preTokenBalances = tx.meta.preTokenBalances || [];
              const postTokenBalances = tx.meta.postTokenBalances || [];

              // Calculate token changes
              for (const post of postTokenBalances) {
                const pre = preTokenBalances.find(b => b.accountIndex === post.accountIndex);
                if (!pre || post.uiTokenAmount.uiAmount > pre.uiTokenAmount.uiAmount) {
                  inTokens.push({
                    mint: post.mint,
                    amount: post.uiTokenAmount.uiAmount - (pre?.uiTokenAmount.uiAmount || 0),
                    usdValue: 0 // You would need to fetch historical prices here
                  });
                }
              }

              for (const pre of preTokenBalances) {
                const post = postTokenBalances.find(b => b.accountIndex === pre.accountIndex);
                if (!post || pre.uiTokenAmount.uiAmount > post.uiTokenAmount.uiAmount) {
                  outTokens.push({
                    mint: pre.mint,
                    amount: pre.uiTokenAmount.uiAmount - (post?.uiTokenAmount.uiAmount || 0),
                    usdValue: 0 // You would need to fetch historical prices here
                  });
                }
              }

              // Calculate rough profit/loss (this would need historical prices for accuracy)
              const solChange = (postBalances[0] - preBalances[0]) / 1e9;
              profit = solChange * solPrice;
            } else if (tx.meta.preBalances[0] !== tx.meta.postBalances[0]) {
              // SOL transfer
              type = 'SOL_TRANSFER';
              const solChange = (tx.meta.postBalances[0] - tx.meta.preBalances[0]) / 1e9;
              
              if (solChange > 0) {
                inTokens.push({
                  mint: 'SOL',
                  amount: solChange,
                  usdValue: solChange * solPrice
                });
              } else if (solChange < 0) {
                outTokens.push({
                  mint: 'SOL',
                  amount: Math.abs(solChange),
                  usdValue: Math.abs(solChange) * solPrice
                });
              }
            }

            transactions.push({
              signature: sig.signature,
              timestamp,
              type,
              inTokens,
              outTokens,
              fees,
              profit
            });
          } catch (error) {
            console.error(`Error processing transaction ${sig.signature}:`, error);
          }
        }

        // Calculate tax summary
        const taxSummary = {
          totalIncome: 0,
          capitalGains: 0,
          totalFees: transactions.reduce((sum, tx) => sum + tx.fees, 0),
          taxLiability: 0
        };

        // Calculate income and capital gains
        for (const tx of transactions) {
          if (tx.type === 'SWAP') {
            if (tx.profit > 0) {
              taxSummary.capitalGains += tx.profit;
            }
          } else if (tx.type === 'SOL_TRANSFER' && tx.inTokens.length > 0) {
            taxSummary.totalIncome += tx.inTokens[0].usdValue;
          }
        }

        // Calculate tax liability (simplified)
        taxSummary.taxLiability = (taxSummary.totalIncome * 0.37) + (taxSummary.capitalGains * 0.20);

        res.json({
          balance: (balance / 1e9).toString(),
          balanceUSD: ((balance / 1e9) * solPrice).toFixed(2),
          tokenAccounts,
          transactions,
          taxSummary
        });

    } catch (error) {
        console.error('Error processing request:', error);
        res.status(500).json({
            error: 'Failed to fetch transactions',
            details: error.message
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Serve React app for any unknown routes in production
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

// Handle 404s
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`Environment: ${process.env.NODE_ENV}`);
    console.log(`Using RPC endpoint: ${process.env.SOLANA_RPC_URL}`);
});
