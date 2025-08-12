import React, { useState } from 'react';
import { Upload, FileText, DollarSign, TrendingUp, AlertCircle, Calculator, PieChart, Target, Shield, Loader2, CheckCircle, XCircle, ArrowRight, Sparkles } from 'lucide-react';
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
  const [exitScenario, setExitScenario] = useState({
    exitValuation: 100000000,
    yearsToExit: 5
  });

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Header with Intrepid branding */}
      <div className="bg-intrepid-dark">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <img 
                src="/assets/logos/intrepid-horizontal.svg" 
                alt="Intrepid Finance" 
                className="h-10 w-auto"
              />
            </div>
            <p className="text-intrepid-gray text-sm font-open-sans italic">providing capital for business growth</p>
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

        {/* Upload Section */}
        <div className="bg-white rounded-lg shadow-md p-6 border border-intrepid-gray/20">
          <h2 className="text-xl font-montserrat font-semibold mb-4 flex items-center text-intrepid-dark">
            <Upload className="mr-2 text-intrepid-green" /> Upload Documents
          </h2>
        
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

        {/* Results Section */}
        {analysis && analysis.investmentTerms && analysis.liquidation && (
          <>
            {/* Key Metrics Dashboard */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white rounded-lg shadow-lg p-6 border-t-4 border-intrepid-green hover:shadow-xl transition-shadow">
                <div className="flex flex-col">
                  <div className="flex items-center justify-between mb-3">
                    <div className="h-12 w-12 bg-intrepid-green/10 rounded-lg flex items-center justify-center">
                      <DollarSign className="h-6 w-6 text-intrepid-green" />
                    </div>
                    <span className="text-xs font-open-sans text-intrepid-green font-semibold uppercase tracking-wider">Investment</span>
                  </div>
                  <span className="text-3xl font-montserrat font-bold text-intrepid-dark">
                    ${((analysis.investmentTerms?.investment || 0) / 1000000).toFixed(1)}M
                  </span>
                  <p className="text-sm text-intrepid-dark/60 font-open-sans mt-2">Total Funding</p>
                </div>
              </div>
              
              <div className="bg-white rounded-lg shadow-lg p-6 border-t-4 border-intrepid-blue hover:shadow-xl transition-shadow">
                <div className="flex flex-col">
                  <div className="flex items-center justify-between mb-3">
                    <div className="h-12 w-12 bg-intrepid-blue/10 rounded-lg flex items-center justify-center">
                      <PieChart className="h-6 w-6 text-intrepid-blue" />
                    </div>
                    <span className="text-xs font-open-sans text-intrepid-blue font-semibold uppercase tracking-wider">Equity</span>
                  </div>
                  <span className="text-3xl font-montserrat font-bold text-intrepid-dark">
                    {analysis.investmentTerms?.statedOwnershipPct || 0}%
                  </span>
                  <p className="text-sm text-intrepid-dark/60 font-open-sans mt-2">Investor Share</p>
                </div>
              </div>
              
              <div className="bg-white rounded-lg shadow-lg p-6 border-t-4 border-intrepid-green hover:shadow-xl transition-shadow">
                <div className="flex flex-col">
                  <div className="flex items-center justify-between mb-3">
                    <div className="h-12 w-12 bg-intrepid-green/10 rounded-lg flex items-center justify-center">
                      <Target className="h-6 w-6 text-intrepid-green" />
                    </div>
                    <span className="text-xs font-open-sans text-intrepid-green font-semibold uppercase tracking-wider">Valuation</span>
                  </div>
                  <span className="text-3xl font-montserrat font-bold text-intrepid-dark">
                    ${((analysis.investmentTerms?.postMoney || 0) / 1000000).toFixed(1)}M
                  </span>
                  <p className="text-sm text-intrepid-dark/60 font-open-sans mt-2">Post-Money</p>
                </div>
              </div>
              
              <div className="bg-white rounded-lg shadow-lg p-6 border-t-4 border-intrepid-blue hover:shadow-xl transition-shadow">
                <div className="flex flex-col">
                  <div className="flex items-center justify-between mb-3">
                    <div className="h-12 w-12 bg-intrepid-blue/10 rounded-lg flex items-center justify-center">
                      <Shield className="h-6 w-6 text-intrepid-blue" />
                    </div>
                    <span className="text-xs font-open-sans text-intrepid-blue font-semibold uppercase tracking-wider">Preference</span>
                  </div>
                  <span className="text-3xl font-montserrat font-bold text-intrepid-dark">
                    {analysis.liquidation?.liqPrefMultiple || 1}x
                  </span>
                  <p className="text-sm text-intrepid-dark/60 font-open-sans mt-2">Liquidation Multiple</p>
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

            {/* Waterfall Calculator */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-lg font-montserrat font-semibold mb-4 flex items-center text-intrepid-dark">
                <Calculator className="mr-2 text-intrepid-blue" /> Exit Waterfall Calculator
              </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-sm font-montserrat font-semibold text-intrepid-dark mb-1">
                    Exit Valuation ($M)
                  </label>
                  <input
                    type="number"
                    value={exitScenario.exitValuation / 1000000}
                    onChange={(e) => setExitScenario({
                      ...exitScenario,
                      exitValuation: e.target.value * 1000000
                    })}
                    className="w-full px-3 py-2 border border-intrepid-gray/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-intrepid-green font-open-sans"
                  />
              </div>
                <div>
                  <label className="block text-sm font-montserrat font-semibold text-intrepid-dark mb-1">
                    Years to Exit
                  </label>
                  <input
                    type="number"
                    value={exitScenario.yearsToExit}
                    onChange={(e) => setExitScenario({
                      ...exitScenario,
                      yearsToExit: parseInt(e.target.value)
                    })}
                    className="w-full px-3 py-2 border border-intrepid-gray/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-intrepid-green font-open-sans"
                  />
              </div>
            </div>

            {waterfall && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-intrepid-blue/10 rounded-lg p-4 border border-intrepid-blue/20">
                    <p className="text-sm text-intrepid-dark/70 font-open-sans mb-1">Investor Return</p>
                    <p className="text-2xl font-montserrat font-bold text-intrepid-blue">
                    ${(waterfall.investorReturn / 1000000).toFixed(1)}M
                  </p>
                    <p className="text-sm text-intrepid-dark/60 font-open-sans">
                      {waterfall.investorMultiple.toFixed(1)}x multiple
                    </p>
                  </div>
                  <div className="bg-intrepid-green/10 rounded-lg p-4 border border-intrepid-green/20">
                    <p className="text-sm text-intrepid-dark/70 font-open-sans mb-1">Founder Return</p>
                    <p className="text-2xl font-montserrat font-bold text-intrepid-green">
                    ${(waterfall.founderReturn / 1000000).toFixed(1)}M
                  </p>
                    <p className="text-sm text-intrepid-dark/60 font-open-sans">
                      {waterfall.founderPct.toFixed(1)}% of exit
                    </p>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      
      {/* Footer */}
      <footer className="bg-intrepid-dark mt-12 py-8">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center justify-between">
            <div className="flex items-center mb-4 md:mb-0">
              <img 
                src="/assets/logos/intrepid-triangles.svg" 
                alt="Intrepid" 
                className="h-8 w-auto mr-3"
              />
              <div>
                <p className="text-intrepid-green font-montserrat font-bold">INTREPID FINANCE</p>
                <p className="text-intrepid-gray text-xs font-open-sans">providing capital for business growth</p>
              </div>
            </div>
            <div className="text-center md:text-right">
              <p className="text-intrepid-gray text-sm font-open-sans mb-1">Powered by AI Technology</p>
              <p className="text-intrepid-gray/60 text-xs font-open-sans">© 2024 Intrepid Finance. All rights reserved.</p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default TermSheetAnalyzer;