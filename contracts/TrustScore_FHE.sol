pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract TrustScoreFHE is ZamaEthereumConfig {
    struct LoanRecord {
        address borrower;
        euint32 encryptedRepaymentAmount;
        uint256 loanAmount;
        uint256 dueDate;
        bool isRepaid;
        uint32 decryptedRepaymentAmount;
        bool isVerified;
    }

    struct TrustScore {
        address user;
        euint32 encryptedScore;
        uint32 decryptedScore;
        bool isVerified;
    }

    mapping(address => LoanRecord[]) public userLoans;
    mapping(address => TrustScore) public userScores;
    mapping(address => bool) public hasScore;

    event LoanRecordCreated(address indexed borrower, uint256 loanAmount, uint256 dueDate);
    event RepaymentVerified(address indexed borrower, uint32 repaymentAmount);
    event TrustScoreCalculated(address indexed user, euint32 encryptedScore);
    event TrustScoreVerified(address indexed user, uint32 score);

    constructor() ZamaEthereumConfig() {}

    function createLoan(
        address borrower,
        externalEuint32 encryptedRepaymentAmount,
        bytes calldata inputProof,
        uint256 loanAmount,
        uint256 dueDate
    ) external {
        require(FHE.isInitialized(FHE.fromExternal(encryptedRepaymentAmount, inputProof)), "Invalid encrypted input");

        userLoans[borrower].push(LoanRecord({
            borrower: borrower,
            encryptedRepaymentAmount: FHE.fromExternal(encryptedRepaymentAmount, inputProof),
            loanAmount: loanAmount,
            dueDate: dueDate,
            isRepaid: false,
            decryptedRepaymentAmount: 0,
            isVerified: false
        }));

        FHE.allowThis(userLoans[borrower][userLoans[borrower].length - 1].encryptedRepaymentAmount);
        FHE.makePubliclyDecryptable(userLoans[borrower][userLoans[borrower].length - 1].encryptedRepaymentAmount);

        emit LoanRecordCreated(borrower, loanAmount, dueDate);
    }

    function verifyRepayment(
        address borrower,
        uint256 loanIndex,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(loanIndex < userLoans[borrower].length, "Invalid loan index");
        LoanRecord storage loan = userLoans[borrower][loanIndex];
        require(!loan.isVerified, "Repayment already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(loan.encryptedRepaymentAmount);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);

        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));

        loan.decryptedRepaymentAmount = decodedValue;
        loan.isRepaid = true;
        loan.isVerified = true;

        emit RepaymentVerified(borrower, decodedValue);
    }

    function calculateTrustScore(address user) external {
        require(userLoans[user].length > 0, "No loan records found");

        euint32 encryptedScore = FHE.encrypt(0);

        for (uint256 i = 0; i < userLoans[user].length; i++) {
            LoanRecord storage loan = userLoans[user][i];
            require(loan.isVerified, "Some repayments not verified");

            euint32 repaymentRatio = FHE.div(
                FHE.mul(FHE.encrypt(100), loan.encryptedRepaymentAmount),
                FHE.encrypt(loan.loanAmount)
            );

            encryptedScore = FHE.add(encryptedScore, repaymentRatio);
        }

        encryptedScore = FHE.div(encryptedScore, FHE.encrypt(userLoans[user].length));

        userScores[user] = TrustScore({
            user: user,
            encryptedScore: encryptedScore,
            decryptedScore: 0,
            isVerified: false
        });

        FHE.allowThis(userScores[user].encryptedScore);
        FHE.makePubliclyDecryptable(userScores[user].encryptedScore);
        hasScore[user] = true;

        emit TrustScoreCalculated(user, encryptedScore);
    }

    function verifyTrustScore(
        address user,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(hasScore[user], "Trust score not calculated");
        require(!userScores[user].isVerified, "Score already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(userScores[user].encryptedScore);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);

        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));

        userScores[user].decryptedScore = decodedValue;
        userScores[user].isVerified = true;

        emit TrustScoreVerified(user, decodedValue);
    }

    function getLoanRecords(address user) external view returns (LoanRecord[] memory) {
        return userLoans[user];
    }

    function getTrustScore(address user) external view returns (TrustScore memory) {
        require(hasScore[user], "Trust score not found");
        return userScores[user];
    }

    function getEncryptedTrustScore(address user) external view returns (euint32) {
        require(hasScore[user], "Trust score not found");
        return userScores[user].encryptedScore;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}

