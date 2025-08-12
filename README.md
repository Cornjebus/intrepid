# Intrepid

**AI-Powered VC Term Sheet Analyzer**

Intrepid empowers founders and investors with instant, comprehensive analysis of venture capital term sheets. Upload your documents and get detailed breakdowns of investment terms, liquidation waterfalls, and founder impact assessments.

## 🚀 Features

- **Document Upload**: Support for PDF, DOCX, and TXT term sheets
- **AI Analysis**: Powered by OpenAI's GPT-4 for accurate term extraction
- **Plain English Explanations**: Complex legal terms made simple
- **Founder Impact Assessment**: Identifies founder-friendly vs concerning terms
- **Waterfall Calculator**: Real-time exit scenario modeling
- **Visual Dashboard**: Charts and metrics for easy understanding
- **Gotchas Detection**: Automatically flags potentially problematic clauses

## 🏗️ Built With

- **React** - Frontend framework
- **Tailwind CSS** - Styling
- **OpenAI API** - Document analysis
- **Recharts** - Data visualization
- **Lucide React** - Icons

## 🛠️ Setup

1. Clone the repository
   ```bash
   git clone https://github.com/Cornjebus/intrepid.git
   cd intrepid
   ```

2. Install dependencies
   ```bash
   npm install
   ```

3. Create environment file
   ```bash
   cp .env.example .env.local
   ```

4. Add your OpenAI API key to `.env.local`
   ```
   REACT_APP_OPENAI_API_KEY=your_openai_api_key_here
   ```

5. Start development server
   ```bash
   npm start
   ```

## 🚀 Deployment

### Vercel (Recommended)
1. Connect your GitHub repository to Vercel
2. Add `REACT_APP_OPENAI_API_KEY` environment variable
3. Deploy automatically on push

### Netlify
1. Connect GitHub repository to Netlify
2. Set build command: `npm run build`
3. Set publish directory: `build`
4. Add environment variables in dashboard

## 🔒 Security

- API keys are handled via environment variables
- Files are processed securely through OpenAI's API
- No data is stored locally or logged

## ⚖️ Legal

**Not Legal Advice**: This tool provides analysis for informational purposes only and should not be considered legal advice. Always consult with qualified legal counsel for investment decisions.

## 📧 Contact

Built by Intrepid Finance
- Website: intrepidfinance.io
- Phone: 317.207.2235

## 📄 License

MIT License - see LICENSE file for details