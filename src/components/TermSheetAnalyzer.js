import React, { useState, useEffect } from 'react';
import { Upload, FileText, DollarSign, TrendingUp, AlertCircle, Calculator, PieChart, Target, Shield, Loader2, CheckCircle, XCircle, ArrowRight, Sparkles, Brain, Lock, Zap, ChevronDown, ChevronUp, RefreshCw, Download, Printer, Share2 } from 'lucide-react';
import { BarChart, Bar, PieChart as RechartsPieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { extractTextFromPDF } from '../utils/pdfExtractor';

// Retry function with exponential backoff for rate limits
const retryWithBackoff = async (fn, maxRetries = 3, initialDelay = 1000) => {
  let lastError;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Only retry on rate limit errors (429), not quota errors
      if (error.message && error.message.includes('rate limit') && !error.message.includes('quota')) {
        const delay = initialDelay * Math.pow(2, i);
        console.log(`Rate limited. Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        // Don't retry on other errors
        throw error;
      }
    }
  }
  
  throw lastError;
};

const TermSheetAnalyzer = () => {
  const [files, setFiles] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showLanding, setShowLanding] = useState(true);
  const [uploadCollapsed, setUploadCollapsed] = useState(false);
  const [exitScenario, setExitScenario] = useState({
    exitValuation: 100000000,
    yearsToExit: 5
  });
  
  // Multiple scenarios for comparison
  const [scenarios, setScenarios] = useState([
    { id: 1, name: 'Conservative', exitValuation: 50000000, yearsToExit: 3, active: false },
    { id: 2, name: 'Base Case', exitValuation: 100000000, yearsToExit: 5, active: true },
    { id: 3, name: 'Optimistic', exitValuation: 250000000, yearsToExit: 5, active: false }
  ]);

  // Auto-collapse upload section and scroll to calculator after analysis
  useEffect(() => {
    if (analysis) {
      setUploadCollapsed(true);
      setTimeout(() => {
        document.getElementById('exit-calculator')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 300);
    }
  }, [analysis]);

  const handleFileUpload = (event) => {
    const uploadedFiles = Array.from(event.target.files);
    setFiles(uploadedFiles);
    setError('');
  };

  const analyzeTermSheet = async () => {
    console.log('Starting analysis...');
    if (files.length === 0) {
      setError('Please upload at least one file');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const apiKey = process.env.REACT_APP_OPENAI_API_KEY;
      console.log('API Key exists:', !!apiKey);
      
      if (!apiKey) {
        throw new Error('OpenAI API key not configured. Please contact support.');
      }

      // Read file contents
      let documentContent = '';
      for (const file of files) {
        let text = '';
        
        try {
          // Check if it's a PDF file
          if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
            console.log('PDF detected - extracting text...');
            text = await extractTextFromPDF(file);
          } else {
            // For text files, read directly
            text = await file.text();
          }
        } catch (extractError) {
          console.error('Error extracting file content:', extractError);
          setError(`Failed to read ${file.name}: ${extractError.message}`);
          setLoading(false);
          return;
        }
        
        documentContent += `\n\n--- ${file.name} ---\n${text}`;
      }

      // Truncate content if too long (API has token limits)
      const maxLength = 30000; // Characters, not tokens, but gives us room
      if (documentContent.length > maxLength) {
        documentContent = documentContent.substring(0, maxLength) + '\n\n[Document truncated due to length]';
      }
      
      console.log('Document content length:', documentContent.length);
      console.log('First 200 chars:', documentContent.substring(0, 200));

      // Analyze the document content directly
      const analysisResult = await retryWithBackoff(async () => {
        console.log('Making API call...');
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'gpt-4-turbo',
            messages: [
              {
                role: 'system',
                content: `You are an expert venture capital analyst. Analyze this investment document and extract ALL relevant terms, regardless of format or document type.

DOCUMENT TYPES TO HANDLE:
- Term sheets (Series A, B, C, etc.)
- SAFE agreements (Simple Agreement for Future Equity)
- Convertible notes
- Investment agreements
- LOIs (Letters of Intent)

EXTRACTION INSTRUCTIONS:
1. Work with whatever format the document uses - don't expect specific structure
2. Common term variations to recognize:
   - Investment: funding amount, capital commitment, purchase price, investment size
   - Valuation: pre-money, post-money, cap, enterprise value, company valuation
   - Ownership: equity %, shareholding, dilution, ownership percentage
   - Liquidation: preference, waterfall, senior preference, return multiple
3. If a field cannot be determined, set it to null
4. If you can calculate missing values from available data, do so
5. Include confidence scores (0-1) for each major section

RETURN JSON FORMAT:
{
  "documentType": "term_sheet|safe|convertible_note|other",
  "confidence": {
    "overall": 0.95,
    "investment": 0.9,
    "liquidation": 0.8,
    "control": 0.7,
    "warnings": ["List any inconsistencies or concerns"]
  },
  "investmentTerms": {
    "preMoney": null or number,
    "postMoney": null or number,
    "investment": null or number,
    "valuationCap": null or number (for SAFEs/notes),
    "discount": null or number (for SAFEs/notes),
    "statedOwnershipPct": null or number,
    "optionPoolPct": null or number,
    "poolExpandsPre": null or boolean,
    "plainEnglish": "Simple explanation of what this means",
    "founderImpact": "positive|neutral|concerning|negative",
    "whyItMatters": "Why founders should care"
  },
  "liquidation": {
    "liqPrefMultiple": null or number,
    "type": "non-participating|participating|capped-participating|none",
    "participationCapMultiple": null or number,
    "dividends": {
      "ratePct": null or number,
      "compounding": "simple|compound|none"
    },
    "plainEnglish": "explanation",
    "founderImpact": "positive|neutral|concerning|negative",
    "whyItMatters": "explanation"
  },
  "controlGovernance": {
    "boardComposition": null or "description",
    "votingRights": null or "description",
    "protectiveProvisions": null or "description",
    "dragAlong": null or boolean,
    "tagAlong": null or boolean,
    "plainEnglish": "explanation",
    "founderImpact": "positive|neutral|concerning|negative",
    "whyItMatters": "explanation"
  },
  "founderTerms": {
    "vestingSchedule": null or "description",
    "acceleration": null or "description",
    "antiDilution": null or "description",
    "proRata": null or boolean,
    "plainEnglish": "explanation",
    "founderImpact": "positive|neutral|concerning|negative",
    "whyItMatters": "explanation"
  },
  "costOfCapital": {
    "effectiveAPR": null or number,
    "trueDilutionCost": null or number,
    "breakEvenExitValue": null or number,
    "explanation": "How we calculated the true cost"
  },
  "gotchas": ["Hidden terms or concerning provisions"],
  "rawTerms": {
    "description": "Any important terms that don't fit categories above"
  },
  "keyMetrics": {
    "totalDilution": null or number,
    "founderOwnership": null or number,
    "optionPoolOwnership": null or number,
    "investorOwnership": null or number
  }
}

IMPORTANT: Extract whatever you can find. It's better to have partial data than to fail completely.`
              },
              {
                role: 'user',
                content: `Analyze the following term sheet document and extract all key VC terms:\n\n${documentContent}`
              }
            ],
            max_tokens: 2000,
            temperature: 0.1
          })
        });
        
        if (!response.ok) {
          const errorBody = await response.text();
          let errorMessage = `Analysis failed: ${response.statusText}`;
          
          if (response.status === 429) {
            // Check if it's a quota issue or rate limit
            if (errorBody.includes('insufficient_quota')) {
              errorMessage = 'OpenAI API quota exceeded. Please check your billing details or add credits to your account.';
            } else {
              errorMessage = 'OpenAI API rate limit exceeded. Please wait a moment and try again.';
            }
          } else if (response.status === 401) {
            errorMessage = 'Invalid OpenAI API key. Please check your API key and try again.';
          } else if (response.status === 400) {
            errorMessage = 'Invalid request. Please check your document and try again.';
          } else if (response.status === 503) {
            errorMessage = 'OpenAI service is temporarily unavailable. Please try again later.';
          }
          
          console.error('API Error:', errorBody);
          throw new Error(errorMessage);
        }
        
        return await response.json();
      });
      
      console.log('API Response received:', analysisResult);
      
      const analysisText = analysisResult.choices[0].message.content;
      console.log('Analysis text:', analysisText.substring(0, 200));
      
      // Parse the JSON response
      let analysisData;
      try {
        // Remove markdown code blocks if present
        let cleanedText = analysisText;
        if (analysisText.includes('```json')) {
          cleanedText = analysisText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
        } else if (analysisText.includes('```')) {
          cleanedText = analysisText.replace(/```\n?/g, '');
        }
        
        analysisData = JSON.parse(cleanedText);
        console.log('Parsed analysis data:', analysisData);
      } catch (parseError) {
        console.log('JSON parse error, trying to extract...', parseError);
        // If parsing fails, try to extract JSON from the response
        const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          analysisData = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('Failed to parse analysis results');
        }
      }

      setAnalysis(analysisData);
      setLoading(false);
      console.log('Analysis complete!');

    } catch (err) {
      console.error('Analysis error:', err);
      
      // Provide user-friendly error messages
      let userMessage = err.message;
      if (err.message.includes('rate limit')) {
        userMessage = '⚠️ API rate limit reached. The system will automatically retry. If the issue persists, please wait a few minutes and try again.';
      } else if (err.message.includes('API key')) {
        userMessage = '🔑 API key issue detected. Please ensure your OpenAI API key is valid and has sufficient credits.';
      } else if (err.message.includes('Failed to fetch') || err.message.includes('CORS')) {
        userMessage = '🔑 Unable to connect to OpenAI API. This usually means the API key is invalid, expired, or doesn\'t have proper permissions. Please check your API key.';
      } else if (err.message.includes('network') || err.message.includes('fetch')) {
        userMessage = '🌐 Network error. Please check your internet connection and try again.';
      } else if (err.message.includes('timeout')) {
        userMessage = '⏱️ Request timed out. Your document might be too large or complex. Try uploading a smaller file.';
      }
      
      setError(userMessage);
      setLoading(false);
    }
  };

  const calculateCostOfCapital = (analysis, years = 5) => {
    if (!analysis || !analysis.investmentTerms || !analysis.liquidation) return null;
    
    const inv = analysis.investmentTerms;
    const liq = analysis.liquidation;
    
    // Calculate effective cost considering liquidation preference
    const investment = inv.investment || 0;
    const liqPref = investment * (liq.liqPrefMultiple || 1);
    const dividendRate = (liq.dividends?.ratePct || 0) / 100;
    
    // Calculate cumulative cost over time
    let totalCost = 0;
    
    // 1. Liquidation preference acts like debt that must be repaid
    totalCost += liqPref;
    
    // 2. Cumulative dividends add to the cost
    if (liq.dividends?.compounding === 'compound') {
      totalCost += investment * (Math.pow(1 + dividendRate, years) - 1);
    } else {
      totalCost += investment * dividendRate * years;
    }
    
    // 3. Calculate effective APR
    // This treats the equity like a loan with the liquidation preference as principal
    const effectiveAPR = ((totalCost / investment) - 1) / years * 100;
    
    // 4. Calculate break-even exit value
    // The exit value where founders start making money after all preferences
    let breakEvenExit = 0;
    if (liq.type === 'non-participating') {
      // Investor gets greater of liq pref or ownership %
      breakEvenExit = Math.max(totalCost, totalCost / (inv.statedOwnershipPct / 100));
    } else if (liq.type === 'participating') {
      // Investor gets liq pref PLUS ownership of remainder
      breakEvenExit = totalCost / (1 - (inv.statedOwnershipPct / 100));
    }
    
    // 5. True dilution cost (opportunity cost of equity given up)
    const equityValue = inv.postMoney * (inv.statedOwnershipPct / 100);
    const trueDilutionCost = ((equityValue + totalCost) / investment - 1) * 100;
    
    return {
      effectiveAPR: effectiveAPR.toFixed(2),
      breakEvenExit: breakEvenExit,
      trueDilutionCost: trueDilutionCost.toFixed(2),
      totalPreferenceAmount: totalCost,
      explanation: `With ${liq.liqPrefMultiple}x liquidation preference and ${(dividendRate * 100).toFixed(1)}% dividends, the effective cost of this capital is ${effectiveAPR.toFixed(2)}% APR over ${years} years.`
    };
  };

  const calculateWaterfall = (exitVal, years) => {
    if (!analysis || !analysis.liquidation || !analysis.investmentTerms) return null;

    const liq = analysis.liquidation;
    const inv = analysis.investmentTerms;
    
    // Calculate liquidation preference
    const liqPref = inv.investment * (liq.liqPrefMultiple || 1);
    
    // Calculate cumulative dividends if any
    const dividends = liq.dividends ? 
      inv.investment * (liq.dividends.ratePct / 100) * years : 0;
    
    const totalLiqPref = liqPref + dividends;
    
    // Calculate distributions
    let investorReturn = 0;
    let founderReturn = 0;
    
    if (liq.type === 'non-participating') {
      // Investor gets greater of liquidation preference or pro-rata share
      const proRataShare = exitVal * (inv.statedOwnershipPct / 100);
      investorReturn = Math.max(totalLiqPref, proRataShare);
      founderReturn = exitVal - investorReturn;
    } else if (liq.type === 'participating') {
      // Investor gets liquidation preference PLUS pro-rata of remainder
      investorReturn = totalLiqPref;
      const remainder = exitVal - totalLiqPref;
      if (remainder > 0) {
        investorReturn += remainder * (inv.statedOwnershipPct / 100);
        founderReturn = remainder * ((100 - inv.statedOwnershipPct) / 100);
      }
      
      // Apply participation cap if exists
      if (liq.participationCapMultiple) {
        const cap = inv.investment * liq.participationCapMultiple;
        investorReturn = Math.min(investorReturn, cap);
        founderReturn = exitVal - investorReturn;
      }
    }
    
    return {
      investorReturn,
      founderReturn,
      investorMultiple: investorReturn / inv.investment,
      founderPct: (founderReturn / exitVal) * 100
    };
  };


  const getImpactBadge = (impact) => {
    const colors = {
      positive: 'bg-intrepid-green/10 text-intrepid-green border border-intrepid-green/20',
      neutral: 'bg-intrepid-blue/10 text-intrepid-blue border border-intrepid-blue/20',
      concerning: 'bg-orange-100 text-orange-800 border border-orange-200',
      negative: 'bg-red-100 text-red-800 border border-red-200'
    };
    
    return (
      <span className={`px-3 py-1 rounded-full text-xs font-montserrat font-semibold uppercase tracking-wider ${colors[impact] || 'bg-gray-100 text-gray-800 border border-gray-200'}`}>
        {impact}
      </span>
    );
  };

  const waterfall = calculateWaterfall(exitScenario.exitValuation, exitScenario.yearsToExit);
  const costOfCapital = calculateCostOfCapital(analysis, exitScenario.yearsToExit);
  
  // Export to CSV function
  const exportToCSV = () => {
    if (!analysis || !waterfall) return;
    
    const csvData = [
      ['Intrepid VC Term Sheet Analysis'],
      [''],
      ['Exit Scenario Analysis'],
      ['Exit Valuation', `$${(exitScenario.exitValuation / 1000000).toFixed(1)}M`],
      ['Years to Exit', exitScenario.yearsToExit],
      [''],
      ['Returns'],
      ['Investor Return', `$${(waterfall.investorReturn / 1000000).toFixed(1)}M`],
      ['Investor Multiple', `${waterfall.investorMultiple.toFixed(1)}x`],
      ['Founder Return', `$${(waterfall.founderReturn / 1000000).toFixed(1)}M`],
      ['Founder Percentage', `${waterfall.founderPct.toFixed(1)}%`],
      [''],
      ['Investment Terms'],
      ['Pre-Money Valuation', `$${((analysis.investmentTerms?.preMoney || 0) / 1000000).toFixed(1)}M`],
      ['Investment Amount', `$${((analysis.investmentTerms?.investment || 0) / 1000000).toFixed(1)}M`],
      ['Ownership Percentage', `${analysis.investmentTerms?.statedOwnershipPct || 0}%`],
      ['Liquidation Preference', `${analysis.liquidation?.liqPrefMultiple || 1}x`],
      [''],
      ['Scenario Comparison'],
      ...scenarios.map(s => {
        const w = calculateWaterfall(s.exitValuation, s.yearsToExit);
        return [
          s.name,
          `$${(s.exitValuation / 1000000).toFixed(0)}M`,
          `${s.yearsToExit}yr`,
          w ? `$${(w.founderReturn / 1000000).toFixed(1)}M` : 'N/A'
        ];
      })
    ];
    
    const csv = csvData.map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `term-sheet-analysis-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  
  // Share results function
  const shareResults = () => {
    if (!analysis) return;
    
    const shareData = {
      analysis: analysis.investmentTerms,
      scenarios: scenarios,
      exitScenario: exitScenario
    };
    
    const encoded = btoa(JSON.stringify(shareData));
    const shareUrl = `${window.location.origin}${window.location.pathname}?data=${encoded}`;
    
    navigator.clipboard.writeText(shareUrl).then(() => {
      alert('Share link copied to clipboard!');
    }).catch(() => {
      prompt('Copy this link to share:', shareUrl);
    });
  };

  // Landing Page Component
  const LandingPage = () => (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Header */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Green arrow logo */}
              <svg width="40" height="40" viewBox="0 0 100 100" className="mr-2">
                <path d="M20 25 L20 75 L50 50 Z" fill="#5AC278" />
                <path d="M45 25 L45 75 L75 50 Z" fill="#5AC278" opacity="0.7" />
              </svg>
              <span className="text-2xl font-montserrat font-bold text-intrepid-green tracking-wider">INTREPID</span>
            </div>
            <p className="text-intrepid-dark/60 text-sm font-open-sans italic hidden md:block">VC Term Sheet Analyzer</p>
          </div>
        </div>
      </div>

      {/* Hero Section */}
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="text-center mb-16">
          <div className="flex justify-center mb-6">
            <div className="h-20 w-20 bg-gradient-to-br from-intrepid-green to-intrepid-blue rounded-full flex items-center justify-center shadow-xl">
              <Brain className="h-10 w-10 text-white" />
            </div>
          </div>
          <h1 className="text-5xl md:text-6xl font-montserrat font-bold text-intrepid-dark mb-4">
            Understand Your VC Terms
            <span className="block text-intrepid-green mt-2">In Minutes</span>
          </h1>
          <p className="text-xl text-intrepid-dark/70 font-open-sans max-w-3xl mx-auto mb-8">
            AI-powered analysis of term sheets, SAFEs, and investment documents. 
            Get instant insights into what your funding terms really mean for your future.
          </p>
          <button
            onClick={() => setShowLanding(false)}
            className="bg-intrepid-green text-white px-8 py-4 rounded-lg font-montserrat font-semibold text-lg hover:bg-intrepid-green/90 transition-all transform hover:scale-105 shadow-lg inline-flex items-center"
          >
            Start Free Analysis
            <ArrowRight className="ml-2 h-5 w-5" />
          </button>
        </div>

        {/* How It Works */}
        <div className="mb-16">
          <h2 className="text-3xl font-montserrat font-bold text-center text-intrepid-dark mb-12">
            How It Works
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="bg-white rounded-lg p-6 shadow-lg hover:shadow-xl transition-shadow">
                <div className="h-16 w-16 bg-intrepid-green/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Upload className="h-8 w-8 text-intrepid-green" />
                </div>
                <h3 className="text-xl font-montserrat font-semibold text-intrepid-dark mb-2">
                  1. Upload Your Document
                </h3>
                <p className="text-intrepid-dark/70 font-open-sans">
                  Upload your term sheet, SAFE, or investment agreement in PDF or text format
                </p>
              </div>
            </div>
            <div className="text-center">
              <div className="bg-white rounded-lg p-6 shadow-lg hover:shadow-xl transition-shadow">
                <div className="h-16 w-16 bg-intrepid-blue/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Brain className="h-8 w-8 text-intrepid-blue" />
                </div>
                <h3 className="text-xl font-montserrat font-semibold text-intrepid-dark mb-2">
                  2. AI Analyzes Terms
                </h3>
                <p className="text-intrepid-dark/70 font-open-sans">
                  Our AI extracts and interprets key terms, identifying potential gotchas
                </p>
              </div>
            </div>
            <div className="text-center">
              <div className="bg-white rounded-lg p-6 shadow-lg hover:shadow-xl transition-shadow">
                <div className="h-16 w-16 bg-intrepid-green/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Calculator className="h-8 w-8 text-intrepid-green" />
                </div>
                <h3 className="text-xl font-montserrat font-semibold text-intrepid-dark mb-2">
                  3. Model Your Outcomes
                </h3>
                <p className="text-intrepid-dark/70 font-open-sans">
                  Interactive calculator shows exactly what you'll make at different exit scenarios
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Key Features */}
        <div className="mb-16">
          <h2 className="text-3xl font-montserrat font-bold text-center text-intrepid-dark mb-12">
            What You'll Discover
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="bg-white rounded-lg p-6 shadow-md hover:shadow-lg transition-shadow">
              <DollarSign className="h-8 w-8 text-intrepid-green mb-3" />
              <h3 className="font-montserrat font-semibold text-intrepid-dark mb-2">True Cost of Capital</h3>
              <p className="text-intrepid-dark/70 font-open-sans text-sm">
                Understand the real APR of your funding including liquidation preferences
              </p>
            </div>
            <div className="bg-white rounded-lg p-6 shadow-md hover:shadow-lg transition-shadow">
              <Shield className="h-8 w-8 text-intrepid-blue mb-3" />
              <h3 className="font-montserrat font-semibold text-intrepid-dark mb-2">Control & Governance</h3>
              <p className="text-intrepid-dark/70 font-open-sans text-sm">
                See how board composition and voting rights affect your control
              </p>
            </div>
            <div className="bg-white rounded-lg p-6 shadow-md hover:shadow-lg transition-shadow">
              <TrendingUp className="h-8 w-8 text-intrepid-green mb-3" />
              <h3 className="font-montserrat font-semibold text-intrepid-dark mb-2">Exit Waterfall</h3>
              <p className="text-intrepid-dark/70 font-open-sans text-sm">
                Calculate exactly what you'll receive at different exit valuations
              </p>
            </div>
            <div className="bg-white rounded-lg p-6 shadow-md hover:shadow-lg transition-shadow">
              <AlertCircle className="h-8 w-8 text-orange-500 mb-3" />
              <h3 className="font-montserrat font-semibold text-intrepid-dark mb-2">Hidden Gotchas</h3>
              <p className="text-intrepid-dark/70 font-open-sans text-sm">
                Identify concerning provisions that could impact your ownership
              </p>
            </div>
            <div className="bg-white rounded-lg p-6 shadow-md hover:shadow-lg transition-shadow">
              <PieChart className="h-8 w-8 text-intrepid-blue mb-3" />
              <h3 className="font-montserrat font-semibold text-intrepid-dark mb-2">Dilution Analysis</h3>
              <p className="text-intrepid-dark/70 font-open-sans text-sm">
                Understand how option pools and future rounds affect your stake
              </p>
            </div>
            <div className="bg-white rounded-lg p-6 shadow-md hover:shadow-lg transition-shadow">
              <Sparkles className="h-8 w-8 text-intrepid-green mb-3" />
              <h3 className="font-montserrat font-semibold text-intrepid-dark mb-2">Plain English</h3>
              <p className="text-intrepid-dark/70 font-open-sans text-sm">
                Complex legal terms explained in language you can understand
              </p>
            </div>
          </div>
        </div>

        {/* Trust Section */}
        <div className="bg-gradient-to-r from-intrepid-green/10 to-intrepid-blue/10 rounded-lg p-8 mb-16">
          <h2 className="text-3xl font-montserrat font-bold text-center text-intrepid-dark mb-8">
            Your Security is Our Priority
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="text-center">
              <Lock className="h-12 w-12 text-intrepid-green mx-auto mb-3" />
              <h3 className="font-montserrat font-semibold text-intrepid-dark mb-2">No Data Storage</h3>
              <p className="text-intrepid-dark/70 font-open-sans text-sm">
                Your documents are analyzed in real-time and never stored on our servers
              </p>
            </div>
            <div className="text-center">
              <Shield className="h-12 w-12 text-intrepid-blue mx-auto mb-3" />
              <h3 className="font-montserrat font-semibold text-intrepid-dark mb-2">Bank-Level Encryption</h3>
              <p className="text-intrepid-dark/70 font-open-sans text-sm">
                All data transmission is encrypted using industry-standard protocols
              </p>
            </div>
            <div className="text-center">
              <Zap className="h-12 w-12 text-intrepid-green mx-auto mb-3" />
              <h3 className="font-montserrat font-semibold text-intrepid-dark mb-2">Instant Processing</h3>
              <p className="text-intrepid-dark/70 font-open-sans text-sm">
                Analysis happens in seconds with results delivered immediately
              </p>
            </div>
          </div>
        </div>

        {/* CTA Section */}
        <div className="text-center mb-16">
          <h2 className="text-3xl font-montserrat font-bold text-intrepid-dark mb-4">
            Ready to Understand Your Terms?
          </h2>
          <p className="text-xl text-intrepid-dark/70 font-open-sans mb-8">
            Join thousands of founders who've gained clarity on their funding terms
          </p>
          <button
            onClick={() => setShowLanding(false)}
            className="bg-gradient-to-r from-intrepid-green to-intrepid-blue text-white px-10 py-4 rounded-lg font-montserrat font-semibold text-lg hover:shadow-xl transition-all transform hover:scale-105 inline-flex items-center"
          >
            Start Your Free Analysis
            <ArrowRight className="ml-3 h-6 w-6" />
          </button>
        </div>

        {/* Scroll indicator */}
        <div className="text-center pb-8">
          <ChevronDown className="h-8 w-8 text-intrepid-gray animate-bounce mx-auto" />
        </div>
      </div>
    </div>
  );

  // Show landing page if no analysis has been done yet
  if (showLanding && !analysis) {
    return <LandingPage />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Header with Intrepid branding */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center cursor-pointer" onClick={() => {
                  setShowLanding(true);
                  setAnalysis(null);
                  setFiles([]);
                  setUploadCollapsed(false);
                }}>
                {/* Green arrow logo */}
                <svg width="40" height="40" viewBox="0 0 100 100" className="mr-2">
                  <path d="M20 25 L20 75 L50 50 Z" fill="#5AC278" />
                  <path d="M45 25 L45 75 L75 50 Z" fill="#5AC278" opacity="0.7" />
                </svg>
                <span className="text-2xl font-montserrat font-bold text-intrepid-green tracking-wider">INTREPID</span>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {analysis && (
                <button
                  onClick={() => {
                    setFiles([]);
                    setAnalysis(null);
                    setUploadCollapsed(false);
                    setError('');
                  }}
                  className="flex items-center gap-2 px-4 py-2 text-intrepid-dark border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors font-open-sans text-sm"
                >
                  <RefreshCw className="h-4 w-4" />
                  New Analysis
                </button>
              )}
              <button
                onClick={() => {
                  setShowLanding(true);
                  setAnalysis(null);
                  setFiles([]);
                  setUploadCollapsed(false);
                }}
                className="flex items-center gap-2 px-5 py-2 bg-intrepid-green text-white rounded-lg hover:bg-intrepid-green/90 transition-all font-open-sans text-sm shadow-sm"
              >
                Home
              </button>
            </div>
          </div>
        </div>
      </div>
      
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Hero Section */}
        <div className="relative bg-gradient-to-r from-intrepid-green to-intrepid-blue rounded-lg p-8 text-white shadow-xl overflow-hidden">
          <div className="absolute right-0 top-0 opacity-10">
            <img 
              src="/assets/logos/intrepid-triangles.svg" 
              alt="" 
              className="h-32 w-auto transform translate-x-8 -translate-y-4"
            />
          </div>
          <div className="relative z-10">
            <div className="flex items-center mb-3">
              <div className="h-1 w-12 bg-white/80 mr-4"></div>
              <span className="text-white/90 font-open-sans text-sm uppercase tracking-wider">Smart Analysis Tool</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-montserrat font-bold mb-3">VC Term Sheet Analyzer</h1>
            <p className="text-white/90 font-open-sans text-lg">Instantly understand your investment terms with AI-powered insights</p>
          </div>
        </div>

        {/* Upload Section - Collapsible */}
        {uploadCollapsed && analysis ? (
          // Collapsed state - show compact status bar
          <div className="bg-white rounded-lg shadow-md p-4 border border-intrepid-gray/20 flex items-center justify-between">
            <div className="flex items-center">
              <CheckCircle className="h-5 w-5 text-intrepid-green mr-3" />
              <div>
                <span className="font-montserrat font-semibold text-intrepid-dark">Analysis Complete</span>
                <span className="text-intrepid-dark/60 font-open-sans text-sm ml-3">
                  {files[0]?.name || 'Document analyzed'}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setFiles([]);
                  setAnalysis(null);
                  setUploadCollapsed(false);
                  setError('');
                }}
                className="text-intrepid-blue hover:text-intrepid-green transition-colors flex items-center gap-2 font-open-sans text-sm"
              >
                <RefreshCw className="h-4 w-4" />
                New Analysis
              </button>
              <button
                onClick={() => setUploadCollapsed(false)}
                className="text-intrepid-gray hover:text-intrepid-dark transition-colors"
              >
                <ChevronDown className="h-5 w-5" />
              </button>
            </div>
          </div>
        ) : (
          // Expanded state - show full upload interface
          <div className="bg-white rounded-lg shadow-md p-6 border border-intrepid-gray/20">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-montserrat font-semibold flex items-center text-intrepid-dark">
                <Upload className="mr-2 text-intrepid-green" /> Upload Documents
              </h2>
              {analysis && (
                <button
                  onClick={() => setUploadCollapsed(true)}
                  className="text-intrepid-gray hover:text-intrepid-dark transition-colors"
                >
                  <ChevronUp className="h-5 w-5" />
                </button>
              )}
            </div>
          
            <div className="border-2 border-dashed border-intrepid-green/30 rounded-lg p-8 text-center hover:border-intrepid-green/50 transition-all hover:bg-intrepid-green/5 group">
              <input
                type="file"
                multiple
                accept=".pdf,.txt,.doc,.docx"
                onChange={handleFileUpload}
                className="hidden"
                id="file-upload"
              />
              <label htmlFor="file-upload" className="cursor-pointer">
                <div className="mx-auto h-16 w-16 bg-intrepid-green/10 rounded-full flex items-center justify-center mb-4 group-hover:bg-intrepid-green/20 transition-colors">
                  <FileText className="h-8 w-8 text-intrepid-green" />
                </div>
                <p className="text-intrepid-dark font-montserrat font-semibold mb-2">Upload Your Term Sheet</p>
                <p className="text-sm text-intrepid-dark/70 font-open-sans">Click to browse or drag and drop</p>
                <p className="text-xs text-intrepid-blue mt-2 font-open-sans">Supports PDF, TXT, DOC, DOCX up to 10MB</p>
              </label>
            </div>

            {files.length > 0 && (
              <div className="mt-6 p-4 bg-intrepid-green/5 rounded-lg border border-intrepid-green/20">
                <h3 className="font-montserrat font-semibold mb-3 text-intrepid-dark flex items-center">
                  <CheckCircle className="h-5 w-5 mr-2 text-intrepid-green" />
                  Files Ready for Analysis
                </h3>
                <div className="space-y-2">
                  {files.map((file, index) => (
                    <div key={index} className="flex items-center justify-between p-2 bg-white rounded-lg">
                      <div className="flex items-center">
                        <div className="h-8 w-8 bg-intrepid-green/10 rounded flex items-center justify-center mr-3">
                          <FileText className="h-4 w-4 text-intrepid-green" />
                        </div>
                        <span className="text-sm text-intrepid-dark font-open-sans font-medium">
                          {file.name}
                        </span>
                      </div>
                      <span className="text-xs text-intrepid-dark/60 font-open-sans">
                        {(file.size / 1024).toFixed(1)} KB
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start">
                <XCircle className="h-5 w-5 text-red-600 mt-0.5 mr-3 flex-shrink-0" />
                <div>
                  <p className="text-red-800 font-montserrat font-semibold text-sm">Analysis Error</p>
                  <p className="text-red-700 font-open-sans text-sm mt-1">{error}</p>
                </div>
              </div>
            )}

            <button
              onClick={analyzeTermSheet}
              disabled={files.length === 0 || loading}
              className="mt-6 w-full bg-intrepid-green text-white py-3 px-6 rounded-lg font-montserrat font-semibold hover:bg-intrepid-green/90 disabled:bg-intrepid-gray disabled:cursor-not-allowed transition-all transform hover:scale-[1.02] shadow-md flex items-center justify-center"
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin h-5 w-5 mr-2" />
                  Analyzing Document...
                </>
              ) : (
                'Analyze Term Sheet'
              )}
            </button>
            
            {/* Alternative CTA when no analysis */}
            {!analysis && (
              <div className="mt-6 p-4 bg-gradient-to-r from-intrepid-green/10 to-intrepid-blue/10 rounded-lg border border-intrepid-green/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <Sparkles className="h-5 w-5 mr-2 text-intrepid-green" />
                    <span className="text-intrepid-dark font-montserrat font-semibold">Looking for better terms?</span>
                  </div>
                  <a
                    href="https://intrepidtech.io/application/ae231301-fc3f-4bcc-9a76-67df5fe2749d"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-intrepid-green font-open-sans font-semibold hover:text-intrepid-blue transition-colors"
                  >
                    Explore Intrepid Funding →
                  </a>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Exit Waterfall Calculator - MOVED TO TOP */}
        {analysis && analysis.investmentTerms && analysis.liquidation && (
          <div id="exit-calculator" className="bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow p-8 border border-gray-100">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-2xl font-montserrat font-bold text-intrepid-dark flex items-center">
                <div className="h-10 w-10 bg-gradient-to-br from-intrepid-blue/10 to-intrepid-green/10 rounded-lg flex items-center justify-center mr-3">
                  <Calculator className="h-5 w-5 text-intrepid-blue" />
                </div>
                Exit Waterfall Calculator
              </h3>
              <span className="text-xs font-open-sans text-intrepid-dark/50 uppercase tracking-wider">Interactive Model</span>
            </div>
            
            {/* Scenario Quick Select */}
            <div className="mb-8 p-4 bg-gray-50 rounded-lg">
              <p className="text-xs font-montserrat font-semibold text-intrepid-dark/60 uppercase tracking-wider mb-3">Quick Scenarios</p>
              <div className="flex flex-wrap gap-2">
                {scenarios.map(scenario => (
                  <button
                    key={scenario.id}
                    onClick={() => {
                      setExitScenario({
                        exitValuation: scenario.exitValuation,
                        yearsToExit: scenario.yearsToExit
                      });
                      setScenarios(scenarios.map(s => ({
                        ...s,
                        active: s.id === scenario.id
                      })));
                    }}
                    className={`px-5 py-2.5 rounded-full font-open-sans text-sm transition-all ${
                      scenario.active 
                        ? 'bg-gradient-to-r from-intrepid-green to-intrepid-blue text-white shadow-sm' 
                        : 'bg-white text-intrepid-dark hover:shadow-sm border border-gray-200'
                    }`}
                  >
                    {scenario.name}
                    <span className="ml-2 text-xs opacity-80">
                      ${(scenario.exitValuation / 1000000).toFixed(0)}M
                    </span>
                  </button>
                ))}
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <div>
                <label className="block text-sm font-montserrat font-semibold text-intrepid-dark mb-2">
                  Exit Valuation
                </label>
                <div className="space-y-2">
                  <input
                    type="range"
                    min="10"
                    max="500"
                    value={exitScenario.exitValuation / 1000000}
                    onChange={(e) => setExitScenario({
                      ...exitScenario,
                      exitValuation: e.target.value * 1000000
                    })}
                    className="w-full h-2 bg-intrepid-gray/30 rounded-lg appearance-none cursor-pointer slider"
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-intrepid-dark/60 font-open-sans">$</span>
                    <input
                      type="number"
                      value={exitScenario.exitValuation / 1000000}
                      onChange={(e) => setExitScenario({
                        ...exitScenario,
                        exitValuation: e.target.value * 1000000
                      })}
                      className="w-24 px-3 py-1 border border-intrepid-gray/30 rounded-lg focus:outline-none focus:ring-2 focus:ring-intrepid-blue font-open-sans"
                    />
                    <span className="text-sm text-intrepid-dark/60 font-open-sans">Million</span>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-montserrat font-semibold text-intrepid-dark mb-2">
                  Years to Exit
                </label>
                <div className="space-y-2">
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={exitScenario.yearsToExit}
                    onChange={(e) => setExitScenario({
                      ...exitScenario,
                      yearsToExit: parseInt(e.target.value)
                    })}
                    className="w-full h-2 bg-intrepid-gray/30 rounded-lg appearance-none cursor-pointer slider"
                  />
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={exitScenario.yearsToExit}
                      onChange={(e) => setExitScenario({
                        ...exitScenario,
                        yearsToExit: parseInt(e.target.value)
                      })}
                      className="w-24 px-3 py-1 border border-intrepid-gray/30 rounded-lg focus:outline-none focus:ring-2 focus:ring-intrepid-blue font-open-sans"
                      min="1"
                      max="10"
                    />
                    <span className="text-sm text-intrepid-dark/60 font-open-sans">Years</span>
                  </div>
                </div>
              </div>
            </div>

            {waterfall && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                <div className="bg-white rounded-xl p-6 border border-gray-100 hover:shadow-sm transition-all">
                  <div className="flex items-center justify-between mb-4">
                    <div className="h-10 w-10 bg-intrepid-blue/10 rounded-lg flex items-center justify-center">
                      <TrendingUp className="h-5 w-5 text-intrepid-blue" />
                    </div>
                    <span className="text-xs font-open-sans text-intrepid-dark/50 uppercase tracking-wider">Investor</span>
                  </div>
                  <p className="text-3xl font-montserrat font-bold text-intrepid-dark mb-1">
                    ${(waterfall.investorReturn / 1000000).toFixed(1)}M
                  </p>
                  <p className="text-sm text-intrepid-dark/60 font-open-sans">
                    <span className="font-semibold text-intrepid-blue">{waterfall.investorMultiple.toFixed(1)}x</span> multiple
                  </p>
                </div>
                <div className="bg-white rounded-xl p-6 border border-gray-100 hover:shadow-sm transition-all">
                  <div className="flex items-center justify-between mb-4">
                    <div className="h-10 w-10 bg-intrepid-green/10 rounded-lg flex items-center justify-center">
                      <DollarSign className="h-5 w-5 text-intrepid-green" />
                    </div>
                    <span className="text-xs font-open-sans text-intrepid-dark/50 uppercase tracking-wider">Founder</span>
                  </div>
                  <p className="text-3xl font-montserrat font-bold text-intrepid-dark mb-1">
                    ${(waterfall.founderReturn / 1000000).toFixed(1)}M
                  </p>
                  <p className="text-sm text-intrepid-dark/60 font-open-sans">
                    <span className="font-semibold text-intrepid-green">{waterfall.founderPct.toFixed(1)}%</span> of exit
                  </p>
                </div>
              </div>
            )}
            
            {/* Chart Visualizations */}
            {waterfall && analysis && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Payout Distribution Bar Chart */}
                <div className="bg-white rounded-xl p-6 border border-gray-100">
                  <div className="flex items-center justify-between mb-6">
                    <h4 className="text-lg font-montserrat font-semibold text-intrepid-dark">
                      Payout Distribution
                    </h4>
                    <div className="h-8 w-8 bg-gradient-to-br from-intrepid-green/10 to-intrepid-blue/10 rounded-lg flex items-center justify-center">
                      <DollarSign className="h-4 w-4 text-intrepid-green" />
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart
                      data={[
                        {
                          name: 'Liquidation\nPreference',
                          value: (analysis.investmentTerms?.investment || 0) * (analysis.liquidation?.liqPrefMultiple || 1) / 1000000,
                          fill: '#ef4444'
                        },
                        {
                          name: 'Investor\nPayout',
                          value: waterfall.investorReturn / 1000000,
                          fill: '#5093A6'
                        },
                        {
                          name: 'Founder\nPayout',
                          value: waterfall.founderReturn / 1000000,
                          fill: '#5AC278'
                        },
                        {
                          name: 'Option\nPool',
                          value: (exitScenario.exitValuation * ((analysis.investmentTerms?.optionPoolPct || 10) / 100)) / 1000000,
                          fill: '#f59e0b'
                        }
                      ]}
                      margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
                      <XAxis 
                        dataKey="name" 
                        tick={{ fontSize: 11, fill: '#1C1F21' }}
                        angle={0}
                      />
                      <YAxis 
                        tick={{ fontSize: 12, fill: '#1C1F21' }}
                        label={{ value: '$ Millions', angle: -90, position: 'insideLeft', style: { fontSize: 12, fill: '#1C1F21' } }}
                      />
                      <Tooltip 
                        formatter={(value) => `$${value.toFixed(1)}M`}
                        contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e5e5', borderRadius: '8px' }}
                      />
                      <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                        {[
                          { fill: '#ef4444' },
                          { fill: '#5093A6' },
                          { fill: '#5AC278' },
                          { fill: '#f59e0b' }
                        ].map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Ownership Distribution Pie Chart */}
                <div className="bg-white rounded-xl p-6 border border-gray-100">
                  <div className="flex items-center justify-between mb-6">
                    <h4 className="text-lg font-montserrat font-semibold text-intrepid-dark">
                      Post-Investment Ownership
                    </h4>
                    <div className="h-8 w-8 bg-gradient-to-br from-intrepid-blue/10 to-intrepid-green/10 rounded-lg flex items-center justify-center">
                      <PieChart className="h-4 w-4 text-intrepid-blue" />
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={300}>
                    <RechartsPieChart>
                      <Pie
                        data={[
                          { 
                            name: 'Investors', 
                            value: analysis.investmentTerms?.statedOwnershipPct || 25,
                            fill: '#5093A6'
                          },
                          { 
                            name: 'Founders', 
                            value: 100 - (analysis.investmentTerms?.statedOwnershipPct || 25) - (analysis.investmentTerms?.optionPoolPct || 10),
                            fill: '#5AC278'
                          },
                          { 
                            name: 'Option Pool', 
                            value: analysis.investmentTerms?.optionPoolPct || 10,
                            fill: '#f59e0b'
                          }
                        ]}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, value }) => `${name}: ${value.toFixed(0)}%`}
                        outerRadius={100}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        <Cell fill="#5093A6" />
                        <Cell fill="#5AC278" />
                        <Cell fill="#f59e0b" />
                      </Pie>
                      <Tooltip 
                        formatter={(value) => `${value}%`}
                        contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e5e5', borderRadius: '8px' }}
                      />
                      <Legend 
                        verticalAlign="bottom" 
                        height={36}
                        formatter={(value, entry) => (
                          <span style={{ color: entry.color, fontSize: '14px' }}>
                            {value}: {entry.payload.value.toFixed(0)}%
                          </span>
                        )}
                      />
                    </RechartsPieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Scenario Comparison Table */}
            {waterfall && scenarios.length > 0 && (
              <div className="mt-6 bg-white rounded-xl p-6 border border-gray-100">
                <div className="flex items-center justify-between mb-6">
                  <h4 className="text-lg font-montserrat font-semibold text-intrepid-dark">
                    Scenario Comparison
                  </h4>
                  <span className="text-xs font-open-sans text-intrepid-dark/50 uppercase tracking-wider">All Scenarios</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-intrepid-gray/20">
                        <th className="text-left py-2 font-montserrat font-semibold text-intrepid-dark">Scenario</th>
                        <th className="text-right py-2 font-montserrat font-semibold text-intrepid-dark">Exit Value</th>
                        <th className="text-right py-2 font-montserrat font-semibold text-intrepid-dark">Founder Return</th>
                        <th className="text-right py-2 font-montserrat font-semibold text-intrepid-dark">Investor Multiple</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scenarios.map(scenario => {
                        const w = calculateWaterfall(scenario.exitValuation, scenario.yearsToExit);
                        return (
                          <tr key={scenario.id} className="border-b border-intrepid-gray/10">
                            <td className="py-2 font-open-sans">
                              {scenario.name}
                              {scenario.active && <span className="ml-2 text-xs text-intrepid-green">(current)</span>}
                            </td>
                            <td className="text-right py-2 font-open-sans text-intrepid-dark/80">
                              ${(scenario.exitValuation / 1000000).toFixed(0)}M
                            </td>
                            <td className="text-right py-2 font-open-sans font-semibold text-intrepid-green">
                              ${w ? (w.founderReturn / 1000000).toFixed(1) : '0'}M
                            </td>
                            <td className="text-right py-2 font-open-sans text-intrepid-blue">
                              {w ? w.investorMultiple.toFixed(1) : '0'}x
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            
            {/* Export Options */}
            <div className="mt-8 p-4 bg-gray-50 rounded-xl flex flex-wrap items-center justify-between">
              <span className="text-xs font-montserrat font-semibold text-intrepid-dark/60 uppercase tracking-wider mb-2 sm:mb-0">Export Options</span>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={exportToCSV}
                  className="flex items-center gap-2 px-4 py-2 bg-white rounded-lg hover:shadow-sm transition-all font-open-sans text-sm text-intrepid-dark border border-gray-200"
                >
                  <Download className="h-4 w-4 text-intrepid-green" />
                  CSV
                </button>
                <button
                  onClick={() => window.print()}
                  className="flex items-center gap-2 px-4 py-2 bg-white rounded-lg hover:shadow-sm transition-all font-open-sans text-sm text-intrepid-dark border border-gray-200"
                >
                  <Printer className="h-4 w-4 text-intrepid-blue" />
                  Print
                </button>
                <button
                  onClick={shareResults}
                  className="flex items-center gap-2 px-4 py-2 bg-white rounded-lg hover:shadow-sm transition-all font-open-sans text-sm text-intrepid-dark border border-gray-200"
                >
                  <Share2 className="h-4 w-4 text-intrepid-green" />
                  Share
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Results Section */}
        {analysis && analysis.investmentTerms && analysis.liquidation && (
          <>
            {/* Key Metrics Dashboard */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white rounded-xl p-6 border border-gray-100 hover:shadow-sm transition-all">
                <div className="flex flex-col">
                  <div className="flex items-center justify-between mb-3">
                    <div className="h-10 w-10 bg-gradient-to-br from-intrepid-green/10 to-intrepid-green/5 rounded-lg flex items-center justify-center">
                      <DollarSign className="h-5 w-5 text-intrepid-green" />
                    </div>
                    <span className="text-xs font-open-sans text-intrepid-dark/50 uppercase tracking-wider">Investment</span>
                  </div>
                  <span className="text-2xl font-montserrat font-bold text-intrepid-dark">
                    ${((analysis.investmentTerms?.investment || 0) / 1000000).toFixed(1)}M
                  </span>
                  <p className="text-sm text-intrepid-dark/60 font-open-sans mt-1">Total Funding</p>
                </div>
              </div>
              
              <div className="bg-white rounded-xl p-6 border border-gray-100 hover:shadow-sm transition-all">
                <div className="flex flex-col">
                  <div className="flex items-center justify-between mb-3">
                    <div className="h-10 w-10 bg-gradient-to-br from-intrepid-blue/10 to-intrepid-blue/5 rounded-lg flex items-center justify-center">
                      <PieChart className="h-5 w-5 text-intrepid-blue" />
                    </div>
                    <span className="text-xs font-open-sans text-intrepid-dark/50 uppercase tracking-wider">Equity</span>
                  </div>
                  <span className="text-2xl font-montserrat font-bold text-intrepid-dark">
                    {analysis.investmentTerms?.statedOwnershipPct || 0}%
                  </span>
                  <p className="text-sm text-intrepid-dark/60 font-open-sans mt-1">Investor Share</p>
                </div>
              </div>
              
              <div className="bg-white rounded-xl p-6 border border-gray-100 hover:shadow-sm transition-all">
                <div className="flex flex-col">
                  <div className="flex items-center justify-between mb-3">
                    <div className="h-10 w-10 bg-gradient-to-br from-intrepid-green/10 to-intrepid-green/5 rounded-lg flex items-center justify-center">
                      <Target className="h-5 w-5 text-intrepid-green" />
                    </div>
                    <span className="text-xs font-open-sans text-intrepid-dark/50 uppercase tracking-wider">Valuation</span>
                  </div>
                  <span className="text-2xl font-montserrat font-bold text-intrepid-dark">
                    ${((analysis.investmentTerms?.postMoney || 0) / 1000000).toFixed(1)}M
                  </span>
                  <p className="text-sm text-intrepid-dark/60 font-open-sans mt-1">Post-Money</p>
                </div>
              </div>
              
              <div className="bg-white rounded-xl p-6 border border-gray-100 hover:shadow-sm transition-all">
                <div className="flex flex-col">
                  <div className="flex items-center justify-between mb-3">
                    <div className="h-10 w-10 bg-gradient-to-br from-intrepid-blue/10 to-intrepid-blue/5 rounded-lg flex items-center justify-center">
                      <Shield className="h-5 w-5 text-intrepid-blue" />
                    </div>
                    <span className="text-xs font-open-sans text-intrepid-dark/50 uppercase tracking-wider">Preference</span>
                  </div>
                  <span className="text-2xl font-montserrat font-bold text-intrepid-dark">
                    {analysis.liquidation?.liqPrefMultiple || 1}x
                  </span>
                  <p className="text-sm text-intrepid-dark/60 font-open-sans mt-1">Liquidation Multiple</p>
                </div>
              </div>
            </div>

            {/* Detailed Analysis */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Investment Terms */}
              <div className="bg-white rounded-lg shadow-md p-6">
                <h3 className="text-lg font-montserrat font-semibold mb-4 text-intrepid-dark">Investment Terms</h3>
              <div className="space-y-3">
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-intrepid-dark/70 font-open-sans">Pre-Money Valuation</span>
                      <span className="font-montserrat font-semibold text-intrepid-dark">${((analysis.investmentTerms?.preMoney || 0) / 1000000).toFixed(1)}M</span>
                  </div>
                </div>
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-intrepid-dark/70 font-open-sans">Option Pool</span>
                      <span className="font-montserrat font-semibold text-intrepid-dark">{analysis.investmentTerms?.optionPoolPct || 0}%</span>
                  </div>
                </div>
                  <div className="pt-3 border-t border-intrepid-gray/30">
                    <div className="flex items-start justify-between mb-2">
                      <span className="text-sm font-montserrat font-semibold text-intrepid-dark">Impact Assessment</span>
                    {getImpactBadge(analysis.investmentTerms?.founderImpact)}
                    </div>
                    <p className="text-sm text-intrepid-dark/70 font-open-sans">{analysis.investmentTerms?.plainEnglish || ''}</p>
                </div>
              </div>
            </div>

              {/* Liquidation Terms */}
              <div className="bg-white rounded-lg shadow-md p-6">
                <h3 className="text-lg font-montserrat font-semibold mb-4 text-intrepid-dark">Liquidation Terms</h3>
              <div className="space-y-3">
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-intrepid-dark/70 font-open-sans">Preference Type</span>
                      <span className="font-montserrat font-semibold text-intrepid-dark capitalize">{analysis.liquidation?.type || 'non-participating'}</span>
                  </div>
                </div>
                {analysis.liquidation?.dividends && (
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-gray-700">Cumulative Dividends</span>
                        <span className="font-montserrat font-semibold text-intrepid-dark">{analysis.liquidation?.dividends?.ratePct || 0}%</span>
                    </div>
                  </div>
                )}
                  <div className="pt-3 border-t border-intrepid-gray/30">
                    <div className="flex items-start justify-between mb-2">
                      <span className="text-sm font-montserrat font-semibold text-intrepid-dark">Impact Assessment</span>
                    {getImpactBadge(analysis.liquidation?.founderImpact)}
                    </div>
                    <p className="text-sm text-intrepid-dark/70 font-open-sans">{analysis.liquidation?.plainEnglish || ''}</p>
                </div>
              </div>
            </div>

              {/* Control & Governance */}
              <div className="bg-white rounded-lg shadow-md p-6">
                <h3 className="text-lg font-montserrat font-semibold mb-4 text-intrepid-dark">Control & Governance</h3>
              <div className="space-y-3">
                <div>
                    <p className="text-sm text-intrepid-dark/70 font-open-sans mb-1">Board Composition</p>
                    <p className="font-montserrat font-semibold text-intrepid-dark">{analysis.controlGovernance?.boardComposition || ''}</p>
                </div>
                <div>
                    <p className="text-sm text-intrepid-dark/70 font-open-sans mb-1">Voting Rights</p>
                    <p className="font-montserrat font-semibold text-intrepid-dark">{analysis.controlGovernance?.votingRights || ''}</p>
                </div>
                  <div className="pt-3 border-t border-intrepid-gray/30">
                    <div className="flex items-start justify-between mb-2">
                      <span className="text-sm font-montserrat font-semibold text-intrepid-dark">Impact Assessment</span>
                    {getImpactBadge(analysis.controlGovernance?.founderImpact)}
                    </div>
                    <p className="text-sm text-intrepid-dark/70 font-open-sans">{analysis.controlGovernance?.plainEnglish || ''}</p>
                </div>
              </div>
            </div>

              {/* Founder Terms */}
              <div className="bg-white rounded-lg shadow-md p-6">
                <h3 className="text-lg font-montserrat font-semibold mb-4 text-intrepid-dark">Founder Terms</h3>
              <div className="space-y-3">
                <div>
                    <p className="text-sm text-intrepid-dark/70 font-open-sans mb-1">Vesting Schedule</p>
                    <p className="font-montserrat font-semibold text-intrepid-dark">{analysis.founderTerms?.vestingSchedule || ''}</p>
                </div>
                <div>
                    <p className="text-sm text-intrepid-dark/70 font-open-sans mb-1">Anti-Dilution</p>
                    <p className="font-montserrat font-semibold text-intrepid-dark">{analysis.founderTerms?.antiDilution || ''}</p>
                </div>
                  <div className="pt-3 border-t border-intrepid-gray/30">
                    <div className="flex items-start justify-between mb-2">
                      <span className="text-sm font-montserrat font-semibold text-intrepid-dark">Impact Assessment</span>
                    {getImpactBadge(analysis.founderTerms?.founderImpact)}
                    </div>
                    <p className="text-sm text-intrepid-dark/70 font-open-sans">{analysis.founderTerms?.plainEnglish || ''}</p>
                </div>
              </div>
            </div>
          </div>

            {/* Confidence & Warnings */}
            {analysis?.confidence && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-6">
                <h3 className="text-lg font-montserrat font-semibold mb-4 flex items-center text-amber-800">
                  <AlertCircle className="mr-2" /> Analysis Confidence
                </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div>
                    <p className="text-sm text-intrepid-dark/70 font-open-sans">Overall</p>
                    <p className="text-lg font-montserrat font-bold text-intrepid-dark">{((analysis.confidence?.overall || 0) * 100).toFixed(0)}%</p>
                </div>
                <div>
                    <p className="text-sm text-intrepid-dark/70 font-open-sans">Investment Terms</p>
                    <p className="text-lg font-montserrat font-bold text-intrepid-dark">{((analysis.confidence?.investment || 0) * 100).toFixed(0)}%</p>
                </div>
                <div>
                    <p className="text-sm text-intrepid-dark/70 font-open-sans">Liquidation</p>
                    <p className="text-lg font-montserrat font-bold text-intrepid-dark">{((analysis.confidence?.liquidation || 0) * 100).toFixed(0)}%</p>
                </div>
                <div>
                    <p className="text-sm text-intrepid-dark/70 font-open-sans">Control</p>
                    <p className="text-lg font-montserrat font-bold text-intrepid-dark">{((analysis.confidence?.control || 0) * 100).toFixed(0)}%</p>
                </div>
              </div>
              {analysis.confidence?.warnings && analysis.confidence.warnings.length > 0 && (
                <div className="mt-4">
                  <p className="text-sm font-medium text-yellow-800 mb-2">Warnings:</p>
                  <ul className="space-y-1">
                    {analysis.confidence.warnings.map((warning, index) => (
                      <li key={index} className="text-sm text-yellow-700">• {warning}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

            {/* Gotchas */}
            {analysis?.gotchas && analysis.gotchas.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-6">
                <h3 className="text-lg font-montserrat font-semibold mb-4 flex items-center text-red-800">
                  <AlertCircle className="mr-2" /> Potential Gotchas
                </h3>
                <ul className="space-y-2">
                  {analysis.gotchas.map((gotcha, index) => (
                    <li key={index} className="flex items-start">
                      <span className="text-red-600 mr-2">•</span>
                      <span className="text-red-700 font-open-sans">{gotcha}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Cost of Capital Analysis */}
            {costOfCapital && (
              <div className="bg-gradient-to-r from-intrepid-green/5 to-intrepid-blue/5 border border-intrepid-green/20 rounded-lg p-6">
                <h3 className="text-lg font-montserrat font-semibold mb-4 flex items-center text-intrepid-dark">
                  <TrendingUp className="mr-2 text-intrepid-green" /> True Cost of Capital
                </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-white rounded-lg p-4 border border-intrepid-gray/20">
                    <p className="text-sm text-intrepid-dark/70 font-open-sans mb-1">Effective APR</p>
                    <p className="text-2xl font-montserrat font-bold text-intrepid-green">{costOfCapital.effectiveAPR}%</p>
                    <p className="text-xs text-intrepid-dark/60 font-open-sans">Annual cost of this funding</p>
                </div>
                  <div className="bg-white rounded-lg p-4 border border-intrepid-gray/20">
                    <p className="text-sm text-intrepid-dark/70 font-open-sans mb-1">Break-Even Exit</p>
                    <p className="text-2xl font-montserrat font-bold text-intrepid-green">
                    ${(costOfCapital.breakEvenExit / 1000000).toFixed(1)}M
                  </p>
                    <p className="text-xs text-intrepid-dark/60 font-open-sans">Min exit for founder profit</p>
                </div>
                  <div className="bg-white rounded-lg p-4 border border-intrepid-gray/20">
                    <p className="text-sm text-intrepid-dark/70 font-open-sans mb-1">True Dilution Cost</p>
                    <p className="text-2xl font-montserrat font-bold text-intrepid-green">{costOfCapital.trueDilutionCost}%</p>
                    <p className="text-xs text-intrepid-dark/60 font-open-sans">Total cost including equity</p>
                </div>
              </div>
                <div className="mt-4 p-3 bg-white rounded-lg border border-intrepid-gray/20">
                  <p className="text-sm text-intrepid-dark/80 font-open-sans">{costOfCapital.explanation}</p>
              </div>
              
              {/* CTA Section - You Have Options */}
              <div className="mt-6 p-6 bg-gradient-to-r from-intrepid-green to-intrepid-blue rounded-lg">
                <div className="flex flex-col md:flex-row items-center justify-between">
                  <div className="text-white mb-4 md:mb-0">
                    <div className="flex items-center mb-2">
                      <Sparkles className="h-5 w-5 mr-2" />
                      <h4 className="text-xl font-montserrat font-bold">You Have Options</h4>
                    </div>
                    <p className="text-white/90 font-open-sans">
                      Explore founder-friendly funding alternatives with better terms and true partnership.
                    </p>
                  </div>
                  <a
                    href="https://intrepidtech.io/application/ae231301-fc3f-4bcc-9a76-67df5fe2749d"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center px-6 py-3 bg-white text-intrepid-green font-montserrat font-bold rounded-lg hover:bg-gray-100 transition-all transform hover:scale-105 shadow-lg"
                  >
                    Apply for Funding
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </a>
                </div>
              </div>
            </div>
          )}
          </>
        )}
      </div>
      
      {/* Footer */}
      <footer className="bg-white border-t border-gray-100 mt-12 py-8">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center justify-between">
            <div className="flex items-center mb-4 md:mb-0">
              {/* Green arrow logo */}
              <svg width="32" height="32" viewBox="0 0 100 100" className="mr-3">
                <path d="M20 25 L20 75 L50 50 Z" fill="#5AC278" />
                <path d="M45 25 L45 75 L75 50 Z" fill="#5AC278" opacity="0.7" />
              </svg>
              <div>
                <p className="text-intrepid-green font-montserrat font-bold">INTREPID</p>
                <p className="text-intrepid-dark/60 text-xs font-open-sans">VC Term Sheet Analyzer</p>
              </div>
            </div>
            <div className="text-center md:text-right">
              <p className="text-intrepid-dark/50 text-xs font-open-sans">© 2025 Intrepid Finance. All rights reserved.</p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default TermSheetAnalyzer;