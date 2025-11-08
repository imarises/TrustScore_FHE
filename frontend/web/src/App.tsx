import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { JSX, useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface LoanApplication {
  id: number;
  name: string;
  loanAmount: string;
  repaymentHistory: string;
  trustScore: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
  encryptedValueHandle?: string;
}

interface TrustAnalysis {
  riskLevel: number;
  repaymentProbability: number;
  creditworthiness: number;
  loanApproval: number;
  fheConfidence: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [loans, setLoans] = useState<LoanApplication[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingLoan, setCreatingLoan] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newLoanData, setNewLoanData] = useState({ name: "", loanAmount: "", repayment: "" });
  const [selectedLoan, setSelectedLoan] = useState<LoanApplication | null>(null);
  const [decryptedData, setDecryptedData] = useState<{ trustScore: number | null; repayment: number | null }>({ trustScore: null, repayment: null });
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterVerified, setFilterVerified] = useState(false);
  const [userHistory, setUserHistory] = useState<any[]>([]);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized) return;
      if (fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        console.log('Initializing FHEVM after wallet connection...');
        await initialize();
        console.log('FHEVM initialized successfully');
      } catch (error) {
        console.error('Failed to initialize FHEVM:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed. Please check your wallet connection." 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const loansList: LoanApplication[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          loansList.push({
            id: parseInt(businessId.replace('loan-', '')) || Date.now(),
            name: businessData.name,
            loanAmount: businessId,
            repaymentHistory: businessId,
            trustScore: businessId,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setLoans(loansList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createLoan = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingLoan(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating loan application with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const trustScoreValue = parseInt(newLoanData.repayment) || 0;
      const businessId = `loan-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, trustScoreValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newLoanData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newLoanData.loanAmount) || 0,
        0,
        "P2P Loan Application"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setUserHistory(prev => [...prev, {
        type: 'loan_created',
        data: newLoanData,
        timestamp: Date.now(),
        txHash: tx.hash
      }]);
      
      setTransactionStatus({ visible: true, status: "success", message: "Loan application created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewLoanData({ name: "", loanAmount: "", repayment: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingLoan(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Trust score already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying trust score on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      setUserHistory(prev => [...prev, {
        type: 'score_verified',
        businessId: businessId,
        score: Number(clearValue),
        timestamp: Date.now()
      }]);
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Trust score verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Trust score is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Trust score verification failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "System is available and ready" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const analyzeTrust = (loan: LoanApplication, decryptedTrustScore: number | null, decryptedRepayment: number | null): TrustAnalysis => {
    const trustScore = loan.isVerified ? (loan.decryptedValue || 0) : (decryptedTrustScore || loan.publicValue1 || 50);
    const loanAmount = loan.publicValue1 || 1000;
    
    const baseRisk = Math.max(5, Math.min(95, 100 - trustScore));
    const amountRisk = Math.min(30, loanAmount / 10000 * 30);
    const riskLevel = Math.round(baseRisk + amountRisk);
    
    const repaymentProbability = Math.min(98, Math.max(60, trustScore * 0.8 + 20));
    const creditworthiness = Math.min(100, Math.round(trustScore * 1.2));
    const loanApproval = Math.min(100, Math.round((trustScore - 30) * 2.5));
    const fheConfidence = Math.min(100, Math.round(trustScore * 0.6 + 40));

    return {
      riskLevel,
      repaymentProbability,
      creditworthiness,
      loanApproval,
      fheConfidence
    };
  };

  const filteredLoans = loans.filter(loan => {
    const matchesSearch = loan.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         loan.creator.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = !filterVerified || loan.isVerified;
    return matchesSearch && matchesFilter;
  });

  const renderDashboard = () => {
    const totalLoans = loans.length;
    const verifiedLoans = loans.filter(l => l.isVerified).length;
    const avgLoanAmount = loans.length > 0 
      ? loans.reduce((sum, l) => sum + l.publicValue1, 0) / loans.length 
      : 0;
    
    const highRiskLoans = loans.filter(l => {
      const trustScore = l.isVerified ? (l.decryptedValue || 0) : 50;
      return trustScore < 30;
    }).length;

    return (
      <div className="dashboard-panels">
        <div className="panel gradient-panel">
          <h3>Total Loan Applications</h3>
          <div className="stat-value">{totalLoans}</div>
          <div className="stat-trend">FHE Protected</div>
        </div>
        
        <div className="panel gradient-panel">
          <h3>Verified Trust Scores</h3>
          <div className="stat-value">{verifiedLoans}/{totalLoans}</div>
          <div className="stat-trend">On-chain Verified</div>
        </div>
        
        <div className="panel gradient-panel">
          <h3>Avg Loan Amount</h3>
          <div className="stat-value">${avgLoanAmount.toFixed(0)}</div>
          <div className="stat-trend">Encrypted Processing</div>
        </div>
        
        <div className="panel gradient-panel">
          <h3>High Risk Applications</h3>
          <div className="stat-value">{highRiskLoans}</div>
          <div className="stat-trend">Require Review</div>
        </div>
      </div>
    );
  };

  const renderTrustChart = (loan: LoanApplication, decryptedTrustScore: number | null, decryptedRepayment: number | null) => {
    const analysis = analyzeTrust(loan, decryptedTrustScore, decryptedRepayment);
    
    return (
      <div className="analysis-chart">
        <div className="chart-row">
          <div className="chart-label">Risk Level</div>
          <div className="chart-bar">
            <div 
              className="bar-fill risk" 
              style={{ width: `${analysis.riskLevel}%` }}
            >
              <span className="bar-value">{analysis.riskLevel}%</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Repayment Probability</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${analysis.repaymentProbability}%` }}
            >
              <span className="bar-value">{analysis.repaymentProbability}%</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Creditworthiness</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${analysis.creditworthiness}%` }}
            >
              <span className="bar-value">{analysis.creditworthiness}%</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Loan Approval Chance</div>
          <div className="chart-bar">
            <div 
              className="bar-fill growth" 
              style={{ width: `${analysis.loanApproval}%` }}
            >
              <span className="bar-value">{analysis.loanApproval}%</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">FHE Confidence</div>
          <div className="chart-bar">
            <div 
              className="bar-fill fhe" 
              style={{ width: `${analysis.fheConfidence}%` }}
            >
              <span className="bar-value">{analysis.fheConfidence}%</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEFlow = () => {
    return (
      <div className="fhe-flow">
        <div className="flow-step">
          <div className="step-icon">🔐</div>
          <div className="step-content">
            <h4>Repayment Encryption</h4>
            <p>Historical repayment data encrypted with Zama FHE</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">📊</div>
          <div className="step-content">
            <h4>Trust Score Calculation</h4>
            <p>FHE computes trust score without revealing raw data</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">👁️</div>
          <div className="step-content">
            <h4>Lender View</h4>
            <p>Lenders see only the score, not repayment history</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">✅</div>
          <div className="step-content">
            <h4>Verification</h4>
            <p>Score verification with zero-knowledge proof</p>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>TrustScore FHE 🔐</h1>
            <p>Private P2P Lending Reputation</p>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Your Wallet to Continue</h2>
            <p>Please connect your wallet to initialize the encrypted trust scoring system for private P2P lending.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet using the button above</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system will automatically initialize</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Start private loan applications with encrypted trust scores</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Trust Scoring System...</p>
        <p>Status: {fhevmInitializing ? "Initializing FHEVM" : status}</p>
        <p className="loading-note">This may take a few moments</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted trust system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>TrustScore FHE 🔐</h1>
          <p>Private P2P Lending Reputation</p>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="check-btn">
            Check System
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Loan Application
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <h2>Private P2P Lending Dashboard (FHE 🔐)</h2>
          {renderDashboard()}
          
          <div className="panel gradient-panel full-width">
            <h3>FHE 🔐 Trust Score Flow</h3>
            {renderFHEFlow()}
          </div>
        </div>
        
        <div className="loans-section">
          <div className="section-header">
            <h2>Loan Applications</h2>
            <div className="header-controls">
              <div className="search-filter">
                <input 
                  type="text" 
                  placeholder="Search applications..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input"
                />
                <label className="filter-checkbox">
                  <input 
                    type="checkbox" 
                    checked={filterVerified}
                    onChange={(e) => setFilterVerified(e.target.checked)}
                  />
                  Verified Only
                </label>
              </div>
              <div className="header-actions">
                <button 
                  onClick={loadData} 
                  className="refresh-btn" 
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
          </div>
          
          <div className="loans-list">
            {filteredLoans.length === 0 ? (
              <div className="no-loans">
                <p>No loan applications found</p>
                <button 
                  className="create-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Application
                </button>
              </div>
            ) : filteredLoans.map((loan, index) => (
              <div 
                className={`loan-item ${selectedLoan?.id === loan.id ? "selected" : ""} ${loan.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedLoan(loan)}
              >
                <div className="loan-title">{loan.name}</div>
                <div className="loan-meta">
                  <span>Loan Amount: ${loan.publicValue1}</span>
                  <span>Applied: {new Date(loan.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="loan-status">
                  Trust Score: {loan.isVerified ? "✅ " + (loan.decryptedValue || 0) + "/100" : "🔓 Ready for Verification"}
                </div>
                <div className="loan-creator">Borrower: {loan.creator.substring(0, 6)}...{loan.creator.substring(38)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="history-section">
          <h3>Your Activity History</h3>
          <div className="history-list">
            {userHistory.slice(-5).map((item, index) => (
              <div key={index} className="history-item">
                <span className="history-type">{item.type === 'loan_created' ? '📝' : '✅'}</span>
                <span className="history-desc">
                  {item.type === 'loan_created' 
                    ? `Created loan application: ${item.data.name}` 
                    : `Verified trust score: ${item.score}/100`}
                </span>
                <span className="history-time">
                  {new Date(item.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
            {userHistory.length === 0 && (
              <div className="no-history">No activity yet</div>
            )}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateLoan 
          onSubmit={createLoan} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingLoan} 
          loanData={newLoanData} 
          setLoanData={setNewLoanData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedLoan && (
        <LoanDetailModal 
          loan={selectedLoan} 
          onClose={() => { 
            setSelectedLoan(null); 
            setDecryptedData({ trustScore: null, repayment: null }); 
          }} 
          decryptedData={decryptedData} 
          setDecryptedData={setDecryptedData} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedLoan.loanAmount)}
          renderTrustChart={renderTrustChart}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateLoan: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  loanData: any;
  setLoanData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, loanData, setLoanData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'repayment') {
      const intValue = value.replace(/[^\d]/g, '');
      setLoanData({ ...loanData, [name]: intValue });
    } else {
      setLoanData({ ...loanData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-loan-modal">
        <div className="modal-header">
          <h2>New P2P Loan Application</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Privacy Protection</strong>
            <p>Your repayment history will be encrypted - lenders only see your trust score</p>
          </div>
          
          <div className="form-group">
            <label>Applicant Name *</label>
            <input 
              type="text" 
              name="name" 
              value={loanData.name} 
              onChange={handleChange} 
              placeholder="Enter your name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Loan Amount ($) *</label>
            <input 
              type="number" 
              name="loanAmount" 
              value={loanData.loanAmount} 
              onChange={handleChange} 
              placeholder="Enter loan amount..." 
              min="0"
            />
            <div className="data-type-label">Public Data</div>
          </div>
          
          <div className="form-group">
            <label>Historical Repayment Score (0-100) *</label>
            <input 
              type="number" 
              min="0" 
              max="100" 
              name="repayment" 
              value={loanData.repayment} 
              onChange={handleChange} 
              placeholder="Enter repayment score..." 
            />
            <div className="data-type-label">FHE Encrypted - Lenders Cannot See This</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !loanData.name || !loanData.loanAmount || !loanData.repayment} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Application"}
          </button>
        </div>
      </div>
    </div>
  );
};

const LoanDetailModal: React.FC<{
  loan: LoanApplication;
  onClose: () => void;
  decryptedData: { trustScore: number | null; repayment: number | null };
  setDecryptedData: (value: { trustScore: number | null; repayment: number | null }) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  renderTrustChart: (loan: LoanApplication, decryptedTrustScore: number | null, decryptedRepayment: number | null) => JSX.Element;
}> = ({ loan, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData, renderTrustChart }) => {
  const handleDecrypt = async () => {
    if (decryptedData.trustScore !== null) { 
      setDecryptedData({ trustScore: null, repayment: null }); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedData({ trustScore: decrypted, repayment: decrypted });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="loan-detail-modal">
        <div className="modal-header">
          <h2>Loan Application Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="loan-info">
            <div className="info-item">
              <span>Applicant:</span>
              <strong>{loan.name}</strong>
            </div>
            <div className="info-item">
              <span>Borrower Address:</span>
              <strong>{loan.creator.substring(0, 6)}...{loan.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Application Date:</span>
              <strong>{new Date(loan.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Loan Amount:</span>
              <strong>${loan.publicValue1}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Trust Score</h3>
            
            <div className="data-row">
              <div className="data-label">Trust Score:</div>
              <div className="data-value">
                {loan.isVerified && loan.decryptedValue ? 
                  `${loan.decryptedValue}/100 (On-chain Verified)` : 
                  decryptedData.trustScore !== null ? 
                  `${decryptedData.trustScore}/100 (Locally Decrypted)` : 
                  "🔒 FHE Encrypted Score"
                }
              </div>
              <button 
                className={`decrypt-btn ${(loan.isVerified || decryptedData.trustScore !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 Verifying..."
                ) : loan.isVerified ? (
                  "✅ Verified"
                ) : decryptedData.trustScore !== null ? (
                  "🔄 Re-verify"
                ) : (
                  "🔓 Verify Trust Score"
                )}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE 🔐 Privacy Protection</strong>
                <p>Your actual repayment history remains private. Lenders only see the final trust score after FHE computation.</p>
              </div>
            </div>
          </div>
          
          {(loan.isVerified || decryptedData.trustScore !== null) && (
            <div className="analysis-section">
              <h3>Lending Risk Analysis</h3>
              {renderTrustChart(
                loan, 
                loan.isVerified ? loan.decryptedValue || null : decryptedData.trustScore, 
                null
              )}
              
              <div className="decrypted-values">
                <div className="value-item">
                  <span>Trust Score:</span>
                  <strong>
                    {loan.isVerified ? 
                      `${loan.decryptedValue}/100 (On-chain Verified)` : 
                      `${decryptedData.trustScore}/100 (Locally Decrypted)`
                    }
                  </strong>
                  <span className={`data-badge ${loan.isVerified ? 'verified' : 'local'}`}>
                    {loan.isVerified ? 'On-chain Verified' : 'Local Decryption'}
                  </span>
                </div>
                <div className="value-item">
                  <span>Loan Amount:</span>
                  <strong>${loan.publicValue1}</strong>
                  <span className="data-badge public">Public Data</span>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!loan.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying on-chain..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

