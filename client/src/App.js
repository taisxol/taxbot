import React, { useState } from 'react';
import './App.css';
import SocialLinks from './components/SocialLinks';
import logo from './assets/favicon.png';  // Import the logo
import { stateTaxRates } from './data/stateTaxRates';

function App() {
  const [walletAddress, setWalletAddress] = useState('');
  const [walletData, setWalletData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedState, setSelectedState] = useState('CA');
  const [isTokenListCollapsed, setIsTokenListCollapsed] = useState(false);

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
      
      // Use the correct production URL
      const baseUrl = process.env.NODE_ENV === 'production' 
        ? 'https://taxbot.onrender.com'  // Production URL
        : window.location.origin;
      
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

  const formatAmount = (amount) => {
    if (!amount && amount !== 0) return '0.0000';
    const num = parseFloat(amount);
    if (num >= 1000) {
      return num.toLocaleString('en-US', {
        minimumFractionDigits: 4,
        maximumFractionDigits: 4
      });
    }
    // For numbers less than 1000, don't use thousands separator
    return num.toFixed(4);
  };

  const formatCurrency = (amount) => {
    if (!amount && amount !== 0) return '$0.00';
    const num = parseFloat(amount);
    return '$' + num.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
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

  const calculateTaxesForState = (income, gains, state) => {
    const federalIncomeTax = income * 0.37; // 37% federal income tax
    const federalCapitalGainsTax = gains * 0.20; // 20% federal capital gains

    const stateRates = stateTaxRates[state];
    const stateIncomeTax = income * stateRates.incomeTax;
    const stateCapitalGainsTax = gains * stateRates.capitalGainsTax;

    return {
      federal: {
        income: federalIncomeTax,
        capitalGains: federalCapitalGainsTax
      },
      state: {
        income: stateIncomeTax,
        capitalGains: stateCapitalGainsTax
      },
      total: federalIncomeTax + federalCapitalGainsTax + stateIncomeTax + stateCapitalGainsTax
    };
  };

  return (
    <div className="App">
      <header className="App-header">
        <img src={logo} alt="tAIx Logo" className="header-logo" />
        <h1>Solana Tax Calculator</h1>
        <p className="powered-by">powered by $tAIx</p>

        <div className="input-container">
          <div className="state-selector">
            <label htmlFor="state">Select Your State:</label>
            <select 
              id="state" 
              value={selectedState} 
              onChange={(e) => setSelectedState(e.target.value)}
            >
              {Object.entries(stateTaxRates).map(([code, data]) => (
                <option key={code} value={code}>
                  {data.name}
                </option>
              ))}
            </select>
          </div>
          
          <input
            type="text"
            value={walletAddress}
            onChange={(e) => setWalletAddress(e.target.value)}
            placeholder="Enter Solana wallet address"
            className="wallet-input"
          />
          <button 
            onClick={calculateTaxes} 
            disabled={loading || !walletAddress} 
            className="calculate-button"
          >
            {loading ? 'Calculating...' : 'Calculate'}
          </button>
        </div>

        <div className="description">
          <p>Enter your Solana wallet address to calculate taxes</p>
          <p className="beta-notice">Open-source currently in beta, inviting other developers to solve this issue with us</p>
        </div>

        <div className="contract-address">
          <h2>CONTRACT ADDRESS</h2>
          <p>HT9krGhGBso93GwqQg6qWqKwgKvxwmP3Nwd8ACfECydr</p>
        </div>

        <SocialLinks />

        {error && <div className="error-message">{error}</div>}

        {walletData && (
          <div className="results-container">
            <div className="wallet-summary">
              <div className="summary-card">
                <h3>SOL Balance</h3>
                <div className="amount">{formatAmount(walletData.balance)} SOL</div>
                <div className="usd-value">{formatCurrency(walletData.balanceUSD)}</div>
              </div>
              <div className="summary-card">
                <h3>
                  Token Holdings
                  <button 
                    className="collapse-button"
                    onClick={() => setIsTokenListCollapsed(!isTokenListCollapsed)}
                  >
                    {isTokenListCollapsed ? '▼' : '▲'}
                  </button>
                </h3>
                <div className={`token-list-container ${isTokenListCollapsed ? 'collapsed' : 'expanded'}`}>
                  <div className="token-list">
                    {walletData.tokenAccounts?.map((token, index) => (
                      <div key={index} className="token-item">
                        <span className="token-amount">{formatAmount(token.amount)}</span>
                        <span className="token-mint">{token.mint}</span>
                        <span className="token-value">{formatCurrency(token.usdValue)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="summary-total">
                  <span className="label">Total:</span>
                  <span className="value">{formatCurrency(walletData.tokenBalanceUSD)}</span>
                </div>
              </div>
            </div>

            <div className="tax-summary">
              <div className="tax-card">
                <h3>Federal Income Tax</h3>
                <div className="amount">${(walletData.taxSummary?.totalIncome * 0.37).toFixed(2)}</div>
                <small>37% Tax Rate</small>
              </div>
              <div className="tax-card">
                <h3>Federal Capital Gains</h3>
                <div className="amount">${(walletData.taxSummary?.capitalGains * 0.20).toFixed(2)}</div>
                <small>20% Tax Rate</small>
              </div>
              <div className="tax-card">
                <h3>State Tax ({stateTaxRates[selectedState].name})</h3>
                <div className="amount">
                  ${((walletData.taxSummary?.totalIncome + walletData.taxSummary?.capitalGains) * 
                     stateTaxRates[selectedState].incomeTax).toFixed(2)}
                </div>
                <small>{(stateTaxRates[selectedState].incomeTax * 100).toFixed(2)}% Tax Rate</small>
              </div>
              <div className="tax-card">
                <h3>Transaction Fees</h3>
                <div className="amount">${walletData.taxSummary?.totalFees?.toFixed(2) || '0.00'}</div>
                <small>Deductible</small>
              </div>
              <div className="tax-card highlight">
                <h3>Total Tax Liability</h3>
                <div className="amount">
                  ${(
                    walletData.taxSummary?.totalIncome * 0.37 + 
                    walletData.taxSummary?.capitalGains * 0.20 +
                    (walletData.taxSummary?.totalIncome + walletData.taxSummary?.capitalGains) * 
                    stateTaxRates[selectedState].incomeTax
                  ).toFixed(2)}
                </div>
                <small>Federal + State Tax</small>
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
                            color: (tx.profit || 0) >= 0 ? '#4CAF50' : '#f44336'
                          }}>
                            {(tx.profit || 0) >= 0 ? 'Profit' : 'Loss'}: {formatCurrency(Math.abs(tx.profit || 0))}
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
