import React, { useState } from 'react';
import './App.css';
import SocialLinks from './components/SocialLinks';

function App() {
  const [walletAddress, setWalletAddress] = useState('');
  const [walletData, setWalletData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isTokenHoldingsExpanded, setIsTokenHoldingsExpanded] = useState(false);

  const calculateTaxes = async () => {
    if (!walletAddress.trim()) {
      setError('Please enter a wallet address');
      return;
    }

    setLoading(true);
    setError(null);
    setWalletData(null);

    try {
      console.log('Fetching data for wallet:', walletAddress);
      
      // In production, use relative URLs
      const baseUrl = window.location.origin;
      console.log('Using base URL:', baseUrl);
      
      // First check if server is healthy
      console.log('Checking server health...');
      const healthCheck = await fetch(`${baseUrl}/health`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!healthCheck.ok) {
        console.error('Health check failed:', await healthCheck.text());
        throw new Error('Server is not responding');
      }
      
      console.log('Server is healthy, fetching wallet data...');
      // Get transactions and tax data
      const response = await fetch(`${baseUrl}/api/transactions/${walletAddress}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        console.error('API request failed:', await response.text());
        throw new Error('Failed to fetch wallet data');
      }

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }

      console.log('Received data:', data);
      setWalletData(data);
      
    } catch (err) {
      console.error('Error details:', err);
      setError(err.message || 'Failed to fetch data. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value) => {
    return parseFloat(value).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  };

  const formatAmount = (value, decimals = 4) => {
    return parseFloat(value).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  };

  const getTransactionTypeColor = (type) => {
    switch (type) {
      case 'SWAP': return '#4CAF50';
      case 'SOL_TRANSFER': return '#2196F3';
      case 'TRANSFER': return '#9C27B0';
      default: return '#757575';
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Solana Tax Calculator</h1>
        <p className="powered-by">powered by $tAIx</p>
        
        <div className="description">
          <p>Enter your Solana wallet address to calculate taxes</p>
          <p className="beta-notice">Open-source currently in beta, inviting other developers to solve this issue with us</p>
        </div>

        <div className="input-container">
          <input
            type="text"
            value={walletAddress}
            onChange={(e) => setWalletAddress(e.target.value)}
            placeholder="Enter Solana wallet address"
            className="wallet-input"
          />
          <button onClick={calculateTaxes} disabled={loading} className="calculate-button">
            {loading ? 'Calculating...' : 'Calculate'}
          </button>
        </div>

        {error && <div className="error-message">{error}</div>}

        <SocialLinks />

        {walletData && (
          <div className="results-container">
            <div className="wallet-summary">
              <h2>Wallet Summary</h2>
              <div className="summary-grid">
                <div className="summary-item">
                  <h3>SOL Balance</h3>
                  <p>{formatAmount(walletData.balance || 0)} SOL</p>
                  <p className="usd-value">{formatCurrency(walletData.balanceUSD || 0)}</p>
                </div>

                <div className="token-holdings">
                  <div className="section-header" onClick={() => setIsTokenHoldingsExpanded(!isTokenHoldingsExpanded)}>
                    <h2>Token Holdings</h2>
                    <span className={`expand-icon ${isTokenHoldingsExpanded ? 'expanded' : ''}`}>▼</span>
                  </div>
                  {isTokenHoldingsExpanded && (
                    <div className="holdings-grid">
                      {walletData.tokenAccounts && walletData.tokenAccounts.map((token, index) => (
                        <div key={index} className="holding-item">
                          <h3>{token.symbol}</h3>
                          <p className="token-name">{token.name}</p>
                          <p className="token-amount">{token.uiAmount.toLocaleString()}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="tax-summary">
              <h2>Tax Summary</h2>
              <div className="tax-grid">
                <div className="tax-card">
                  <h3>Total Income</h3>
                  <p>{formatCurrency(walletData.taxSummary?.totalIncome || 0)}</p>
                  <small>37% Tax Rate</small>
                </div>
                <div className="tax-card">
                  <h3>Capital Gains</h3>
                  <p>{formatCurrency(walletData.taxSummary?.capitalGains || 0)}</p>
                  <small>20% Tax Rate</small>
                </div>
                <div className="tax-card">
                  <h3>Total Fees</h3>
                  <p>{formatCurrency(walletData.taxSummary?.totalFees || 0)}</p>
                  <small>Deductible</small>
                </div>
                <div className="tax-card highlight">
                  <h3>Tax Liability</h3>
                  <p>{formatCurrency(walletData.taxSummary?.taxLiability || 0)}</p>
                  <small>Estimated Total Tax</small>
                </div>
              </div>
            </div>

            {walletData.transactions?.length > 0 && (
              <div className="transactions">
                <h2>Transaction History</h2>
                <div className="transaction-list">
                  {walletData.transactions.map((tx, index) => (
                    <div key={tx.signature} className="transaction-item">
                      <div className="transaction-header">
                        <span 
                          className="transaction-type"
                          style={{ backgroundColor: getTransactionTypeColor(tx.type) }}
                        >
                          {tx.type}
                        </span>
                        <span className="transaction-date">
                          {new Date(tx.timestamp * 1000).toLocaleString()}
                        </span>
                      </div>
                      
                      <div className="transaction-details">
                        {tx.inTokens?.length > 0 && (
                          <div className="token-flow in">
                            <h4>Received</h4>
                            {tx.inTokens.map((token, i) => (
                              <div key={i} className="token-amount">
                                <span>{formatAmount(token.amount)} {token.mint}</span>
                                <span className="usd-value">
                                  {formatCurrency(token.usdValue)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        
                        {tx.outTokens?.length > 0 && (
                          <div className="token-flow out">
                            <h4>Sent</h4>
                            {tx.outTokens.map((token, i) => (
                              <div key={i} className="token-amount">
                                <span>{formatAmount(token.amount)} {token.mint}</span>
                                <span className="usd-value">
                                  {formatCurrency(token.usdValue)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        
                        {tx.type === 'SWAP' && (
                          <div className="profit-loss" style={{
                            color: tx.profit >= 0 ? '#4CAF50' : '#f44336'
                          }}>
                            {tx.profit >= 0 ? 'Profit' : 'Loss'}: {formatCurrency(Math.abs(tx.profit))}
                          </div>
                        )}

                        {tx.fees > 0 && (
                          <div className="transaction-fees">
                            Fee: {formatAmount(tx.fees)} SOL
                          </div>
                        )}
                      </div>

                      <div className="transaction-link">
                        <a
                          href={`https://solscan.io/tx/${tx.signature}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          View on Solscan
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </header>
    </div>
  );
}

export default App;
