import React, { useState } from 'react';
import './App.css';
import SocialLinks from './components/SocialLinks';
import logo from './assets/favicon.png';  // Import the logo
import { stateTaxRates } from './data/stateTaxRates';

function App() {
  const [walletAddress, setWalletAddress] = useState('');
  const [walletData, setWalletData] = useState(null);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(null);
  const [selectedState, setSelectedState] = useState('California');

  const states = Object.keys(stateTaxRates);

  const fetchWalletData = async (address) => {
    try {
      if (!address || address.trim().length === 0) {
        throw new Error('Please enter a wallet address');
      }

      setError(null);
      setProgress({ status: 'processing', message: 'Starting analysis...' });
      setWalletData(null);

      console.log('Fetching data for wallet:', address);
      setProgress({ status: 'processing', message: 'Validating wallet address...' });
      
      const response = await fetch(`/api/transactions/${address}`);
      const result = await response.json();
      console.log('Server response:', JSON.stringify(result, null, 2));
      
      // Handle error responses
      if (!response.ok || result.error) {
        throw new Error(result.error || 'Server error');
      }

      // Create processed data from response
      const processedData = {
        walletAddress: result.walletAddress || address,
        solBalance: result.balance || 0,
        yearSummary: {
          year: new Date().getFullYear(),
          trades: Array.isArray(result.transactions) ? result.transactions.length : 0,
          totalValue: typeof result.totalValue === 'number' ? result.totalValue : 0,
          transactions: Array.isArray(result.transactions) ? result.transactions : []
        }
      };
      
      console.log('Processed wallet data:', JSON.stringify(processedData, null, 2));
      setWalletData(processedData);
      setProgress({ 
        status: 'complete', 
        message: (processedData.yearSummary.trades > 0) ? 'Analysis complete!' : 'No transactions found for this wallet.' 
      });
    } catch (error) {
      console.error('Error fetching wallet data:', error);
      setError(error.message || 'An unexpected error occurred');
      setProgress({ status: 'error', message: `Analysis failed: ${error.message}` });
      setWalletData(null);
    }
  };

  const handleCalculate = async () => {
    if (!walletAddress || walletAddress.trim().length === 0) {
      setError('Please enter a wallet address');
      setProgress({ status: 'error', message: 'Please enter a wallet address' });
      return;
    }
    await fetchWalletData(walletAddress.trim());
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
        <img src={logo} className="App-logo" alt="logo" />
        <h1>Solana Tax Calculator</h1>
        <p className="powered-by">powered by $tAlx</p>

        <div className="input-section">
          <div className="state-selector">
            <label>Select Your State:</label>
            <select value={selectedState} onChange={(e) => setSelectedState(e.target.value)}>
              {states.map(state => (
                <option key={state} value={state}>{state}</option>
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
            <button onClick={handleCalculate} disabled={!walletAddress || walletAddress.trim().length === 0}>
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
          <div className="results-section">
            <div className="wallet-info">
              <h2>Wallet Summary</h2>
              <p>Address: {walletData.walletAddress}</p>
              <p>SOL Balance: {formatNumber(walletData.solBalance)} SOL</p>
            </div>

            <div className="year-summary">
              <h2>{walletData.yearSummary.year} Summary</h2>
              <p>Total Trades: {walletData.yearSummary.trades}</p>
              <p>Total Value: ${formatNumber(walletData.yearSummary.totalValue)}</p>
            </div>

            {walletData.yearSummary.transactions.length > 0 && (
              <div className="transactions">
                <h2>Recent Transactions</h2>
                <ul>
                  {walletData.yearSummary.transactions.map((tx, index) => (
                    <li key={tx.signature || index}>
                      <span className="tx-date">
                        {tx.timestamp ? new Date(tx.timestamp * 1000).toLocaleDateString() : 'Unknown date'}
                      </span>
                      <span className="tx-value">
                        ${formatNumber(tx.value)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="contract-section">
          <h3>CONTRACT ADDRESS</h3>
          <div className="contract-address">
            HT9krGhGBso93GwqQqGqMqKwqKvxvxwmP3NvdBACfECydr
          </div>
        </div>

        <SocialLinks />
      </header>
    </div>
  );
}

export default App;
