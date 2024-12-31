# TaixBot - Solana Tax Calculator

A web application that analyzes Solana wallet transactions for tax purposes. It tracks token swaps, transfers, and calculates profit/loss.

## Features

- Wallet Balance Analysis
- Token Holdings Display
- Transaction History
- Tax Summary Calculation
  - Total Income
  - Capital Gains
  - Transaction Fees
- Support for Token Swaps and Transfers

## Tech Stack

- Backend: Node.js + Express
- Frontend: React
- Blockchain: Solana Web3.js
- Token Standards: SPL Token

## Prerequisites

- Node.js >= 16.0.0
- npm

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/taixbot.git
cd taixbot
```

2. Install dependencies:
```bash
npm install
cd client && npm install
```

3. Create a `.env` file in the root directory:
```env
PORT=3001
SOLANA_RPC_URL=your_rpc_url
```

4. Start the development server:
```bash
npm run dev:full
```

## Usage

1. Open http://localhost:3000 in your browser
2. Enter a Solana wallet address
3. View the wallet's:
   - Current balance
   - Token holdings
   - Transaction history
   - Tax summary

## Deployment

The application can be deployed on Render:

1. Connect your GitHub repository to Render
2. Create a new Web Service
3. Configure build settings:
   - Build Command: `npm install && npm run build`
   - Start Command: `npm start`
4. Add environment variables

## License

MIT
