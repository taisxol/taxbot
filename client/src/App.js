import React, { useState } from 'react';
import './App.css';
import SocialLinks from './components/SocialLinks';
import logo from './assets/favicon.png';  // Import the logo

const stateTaxRates = {
  'California': { name: 'California', incomeTax: 0.133 },
  'New York': { name: 'New York', incomeTax: 0.109 },
  'Texas': { name: 'Texas', incomeTax: 0 },
  'Florida': { name: 'Florida', incomeTax: 0 },
  'Washington': { name: 'Washington', incomeTax: 0 },
};

function App() {
  const [walletAddress, setWalletAddress] = useState('');
  const [walletData, setWalletData] = useState(null);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(null);
  const [selectedState, setSelectedState] = useState('California');
  const [isTokenListCollapsed, setIsTokenListCollapsed] = useState(true);

  // Get the base URL for API calls
  const getApiUrl = () => {
    if (process.env.NODE_ENV === 'production') {
      // In production, use the same origin
      const origin = window.location.origin;
      console.log('Production API URL:', origin);
      return origin;
    } else {
      // In development, use localhost
      return 'http://localhost:5000';
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setProgress('Connecting to server...');
    
    try {
      // First check if server is healthy
      const healthCheck = await fetch(`${getApiUrl()}/api/health`);
      if (!healthCheck.ok) {
        throw new Error('Server is not responding');
      }

      setProgress('Fetching wallet data...');
      console.log('Fetching data for wallet:', walletAddress);
      
      const response = await fetch(`${getApiUrl()}/api/transactions/${walletAddress}`);
      const data = await response.json();
      
      if (response.ok) {
        console.log('Received wallet data:', data);
        setWalletData(data);
        setProgress(null);
      } else {
        console.error('Server error:', data);
        setError(data.error || 'Failed to fetch wallet data');
        setProgress(null);
      }
    } catch (err) {
      console.error('Connection error:', err);
      setError(`Failed to connect to server: ${err.message}`);
      setProgress(null);
    }
  };

  const handleInputChange = (e) => {
    const value = e.target.value;
    setWalletAddress(value);
    // Clear error when user starts typing
    if (error) {
      setError(null);
      setProgress(null);
    }
  };

  const formatNumber = (value) => {
    if (typeof value !== 'number') return '0';
    return value.toFixed(4);
  };

  const formatAmount = (amount) => {
    if (amount === undefined || amount === null) return '0.0000';
    return parseFloat(amount).toFixed(4);
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

  const states = Object.keys(stateTaxRates);

  return (
    <div className="App">
      <header className="App-header">
        <img src={logo} className="App-logo" alt="logo" />
        <h1>Solana Tax Calculator</h1>
        <p className="powered-by">powered by $tAlx</p>

        <div className="input-section">
          <div className="state-selector">
            <label htmlFor="state-select">Select State: </label>
            <select 
              id="state-select"
              value={selectedState}
              onChange={(e) => setSelectedState(e.target.value)}
            >
              {states.map(state => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
          </div>

          <div className="wallet-input">
            <input
              type="text"
              value={walletAddress}
              onChange={handleInputChange}
              placeholder="Enter your Solana wallet address to calculate taxes"
              className={error ? 'error' : ''}
            />
            <button onClick={handleSubmit} disabled={!walletAddress || walletAddress.trim().length === 0}>
              Calculate
            </button>
          </div>
        </div>

        <p className="beta-notice">
          Open-source currently in beta, inviting other developers to solve this issue with us
        </p>

        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        {progress && (
          <div className={`progress-message ${progress.status}`}>
            {progress.message}
          </div>
        )}

        {walletData && (
          <div className="results-container">
            <div className="wallet-summary">
              <div className="summary-card">
                <h3>SOL Balance</h3>
                <div className="amount">{formatAmount(walletData.solBalance)} SOL</div>
              </div>
              <div className="tax-summary">
                <div className="tax-card">
                  <h3>Federal Income Tax</h3>
                  <div className="amount">Coming Soon</div>
                  <small>37% Tax Rate</small>
                </div>
                <div className="tax-card">
                  <h3>State Income Tax ({stateTaxRates[selectedState].name})</h3>
                  <div className="amount">Coming Soon</div>
                  <small>{(stateTaxRates[selectedState].incomeTax * 100).toFixed(2)}% Tax Rate</small>
                </div>
                <div className="tax-card">
                  <h3>Transaction Fees</h3>
                  <div className="amount">Coming Soon</div>
                  <small>Deductible</small>
                </div>
                <div className="tax-card highlight">
                  <h3 style={{ color: '#ffffff' }}>Total Profits</h3>
                  <div className="amount">Coming Soon</div>
                  <small>Combined Tax Rate: {(37 + stateTaxRates[selectedState].incomeTax * 100).toFixed(2)}%</small>
                </div>
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
                {!isTokenListCollapsed && walletData.tokens && walletData.tokens.length > 0 ? (
                  <ul className="token-list">
                    {walletData.tokens.map((token, index) => (
                      <li key={index} className="token-item">
                        {token.mint}
                      </li>
                    ))}
                  </ul>
                ) : !isTokenListCollapsed && (
                  <div className="amount">No tokens found</div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="contract-address">
          <h2>CONTRACT ADDRESS</h2>
          <p></p>
        </div>

        <SocialLinks />
      </header>
    </div>
  );
}

export default App;
