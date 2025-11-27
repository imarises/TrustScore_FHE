import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface LendingData {
  id: string;
  name: string;
  trustScore: number;
  loanAmount: number;
  repaymentHistory: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [lendings, setLendings] = useState<LendingData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingLending, setCreatingLending] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newLendingData, setNewLendingData] = useState({ name: "", score: "", amount: "" });
  const [selectedLending, setSelectedLending] = useState<LendingData | null>(null);
  const [decryptedScore, setDecryptedScore] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterVerified, setFilterVerified] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
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
      const lendingsList: LendingData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          lendingsList.push({
            id: businessId,
            name: businessData.name,
            trustScore: 0,
            loanAmount: Number(businessData.publicValue1) || 0,
            repaymentHistory: businessData.description,
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
      
      setLendings(lendingsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createLending = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingLending(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating lending record with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const scoreValue = parseInt(newLendingData.score) || 0;
      const businessId = `lending-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, scoreValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newLendingData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newLendingData.amount) || 0,
        0,
        "P2P Lending Reputation"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Lending record created!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewLendingData({ name: "", score: "", amount: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Submission failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingLending(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) return null;
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
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
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data verified!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
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
      
      const available = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "System available" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredLendings = lendings.filter(lending => 
    lending.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
    (!filterVerified || lending.isVerified)
  );

  const stats = {
    total: lendings.length,
    verified: lendings.filter(l => l.isVerified).length,
    totalAmount: lendings.reduce((sum, l) => sum + l.loanAmount, 0),
    avgScore: lendings.length > 0 ? lendings.reduce((sum, l) => sum + l.publicValue1, 0) / lendings.length : 0
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>TrustScore FHE 🔐</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Wallet to Start</h2>
            <p>Connect your wallet to access encrypted P2P lending reputation system</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading lending data...</p>
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
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Record
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-panels">
          <div className="stat-panel">
            <h3>Total Records</h3>
            <div className="stat-value">{stats.total}</div>
          </div>
          <div className="stat-panel">
            <h3>Verified Data</h3>
            <div className="stat-value">{stats.verified}</div>
          </div>
          <div className="stat-panel">
            <h3>Total Amount</h3>
            <div className="stat-value">${stats.totalAmount}</div>
          </div>
          <div className="stat-panel">
            <h3>Avg Score</h3>
            <div className="stat-value">{stats.avgScore.toFixed(1)}</div>
          </div>
        </div>

        <div className="search-section">
          <input
            type="text"
            placeholder="Search records..."
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
          <button onClick={loadData} disabled={isRefreshing} className="refresh-btn">
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="lending-list">
          {filteredLendings.length === 0 ? (
            <div className="no-data">
              <p>No lending records found</p>
              <button onClick={() => setShowCreateModal(true)} className="create-btn">
                Create First Record
              </button>
            </div>
          ) : (
            filteredLendings.map((lending, index) => (
              <div 
                key={index}
                className={`lending-item ${lending.isVerified ? 'verified' : ''}`}
                onClick={() => setSelectedLending(lending)}
              >
                <div className="item-header">
                  <h3>{lending.name}</h3>
                  <span className={`status ${lending.isVerified ? 'verified' : 'pending'}`}>
                    {lending.isVerified ? '✅ Verified' : '🔓 Pending'}
                  </span>
                </div>
                <div className="item-details">
                  <span>Amount: ${lending.loanAmount}</span>
                  <span>Score: {lending.isVerified ? lending.decryptedValue : 'Encrypted'}</span>
                  <span>{new Date(lending.timestamp * 1000).toLocaleDateString()}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>New Lending Record</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-btn">×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Borrower Name</label>
                <input
                  type="text"
                  value={newLendingData.name}
                  onChange={(e) => setNewLendingData({...newLendingData, name: e.target.value})}
                  placeholder="Enter name"
                />
              </div>
              <div className="form-group">
                <label>Trust Score (FHE Encrypted)</label>
                <input
                  type="number"
                  value={newLendingData.score}
                  onChange={(e) => setNewLendingData({...newLendingData, score: e.target.value})}
                  placeholder="Enter score"
                />
              </div>
              <div className="form-group">
                <label>Loan Amount</label>
                <input
                  type="number"
                  value={newLendingData.amount}
                  onChange={(e) => setNewLendingData({...newLendingData, amount: e.target.value})}
                  placeholder="Enter amount"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn">Cancel</button>
              <button 
                onClick={createLending} 
                disabled={creatingLending || isEncrypting}
                className="submit-btn"
              >
                {creatingLending ? 'Creating...' : 'Create Record'}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {selectedLending && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Lending Details</h2>
              <button onClick={() => setSelectedLending(null)} className="close-btn">×</button>
            </div>
            <div className="modal-body">
              <div className="detail-item">
                <span>Borrower:</span>
                <span>{selectedLending.name}</span>
              </div>
              <div className="detail-item">
                <span>Loan Amount:</span>
                <span>${selectedLending.loanAmount}</span>
              </div>
              <div className="detail-item">
                <span>Trust Score:</span>
                <span>
                  {selectedLending.isVerified ? 
                    `${selectedLending.decryptedValue} (Verified)` : 
                    decryptedScore !== null ? 
                    `${decryptedScore} (Decrypted)` : 
                    'Encrypted'
                  }
                </span>
              </div>
              <div className="detail-item">
                <span>Created:</span>
                <span>{new Date(selectedLending.timestamp * 1000).toLocaleString()}</span>
              </div>
              <div className="detail-item">
                <span>Creator:</span>
                <span>{selectedLending.creator.substring(0, 8)}...{selectedLending.creator.substring(36)}</span>
              </div>
              
              <button 
                onClick={async () => {
                  const score = await decryptData(selectedLending.id);
                  if (score !== null) setDecryptedScore(score);
                }}
                disabled={isDecrypting}
                className="decrypt-btn"
              >
                {isDecrypting ? 'Decrypting...' : 'Verify Score'}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {transactionStatus.visible && (
        <div className="notification">
          <div className={`notification-content ${transactionStatus.status}`}>
            {transactionStatus.message}
          </div>
        </div>
      )}

      <footer className="app-footer">
        <p>TrustScore FHE - Encrypted P2P Lending Reputation System</p>
      </footer>
    </div>
  );
};

export default App;