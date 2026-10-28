// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract FreelanciaEscrow is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");
    uint16 public constant FEE_BPS = 200;
    uint16 private constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MIN_DELIVERY_PERIOD = 1 hours;
    uint256 public constant MAX_DELIVERY_PERIOD = 365 days;

    enum Status {
        None,
        Funded,
        Submitted,
        RevisionRequested,
        Disputed,
        Released,
        Refunded
    }

    struct Escrow {
        address client;
        address freelancer;
        uint256 amount;
        uint64 deadline;
        uint32 revisionCount;
        Status status;
    }

    IERC20 public immutable paymentToken;
    address public feeRecipient;
    uint256 public nextEscrowId = 1;
    mapping(uint256 escrowId => Escrow escrow) public escrows;

    event EscrowCreated(
        uint256 indexed escrowId,
        address indexed client,
        address indexed freelancer,
        uint256 amount,
        uint64 deadline
    );
    event WorkSubmitted(uint256 indexed escrowId, address indexed freelancer);
    event RevisionRequested(uint256 indexed escrowId, address indexed client, uint32 revisionCount);
    event DisputeRaised(uint256 indexed escrowId, address indexed raisedBy);
    event EscrowReleased(uint256 indexed escrowId, uint256 freelancerAmount, uint256 feeAmount);
    event EscrowRefunded(uint256 indexed escrowId, address indexed client, uint256 amount);
    event DisputeResolved(uint256 indexed escrowId, bool releasedToFreelancer);
    event FeeRecipientUpdated(address indexed previousRecipient, address indexed newRecipient);

    error InvalidAddress();
    error InvalidAmount();
    error InvalidDeadline();
    error InvalidEscrow();
    error InvalidStatus(Status currentStatus);
    error UnauthorizedParticipant();
    error DeadlineNotReached();

    constructor(IERC20 token, address admin, address arbiter, address initialFeeRecipient) {
        if (address(token) == address(0) || admin == address(0) || arbiter == address(0) || initialFeeRecipient == address(0)) {
            revert InvalidAddress();
        }

        paymentToken = token;
        feeRecipient = initialFeeRecipient;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ARBITER_ROLE, arbiter);
    }

    function createEscrow(address freelancer, uint256 amount, uint64 deadline)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 escrowId)
    {
        if (freelancer == address(0) || freelancer == msg.sender) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (deadline < block.timestamp + MIN_DELIVERY_PERIOD || deadline > block.timestamp + MAX_DELIVERY_PERIOD) {
            revert InvalidDeadline();
        }

        escrowId = nextEscrowId++;
        escrows[escrowId] = Escrow({
            client: msg.sender,
            freelancer: freelancer,
            amount: amount,
            deadline: deadline,
            revisionCount: 0,
            status: Status.Funded
        });

        paymentToken.safeTransferFrom(msg.sender, address(this), amount);
        emit EscrowCreated(escrowId, msg.sender, freelancer, amount, deadline);
    }

    function submitWork(uint256 escrowId) external whenNotPaused {
        Escrow storage escrow = _getEscrow(escrowId);
        if (msg.sender != escrow.freelancer) revert UnauthorizedParticipant();
        if (escrow.status != Status.Funded && escrow.status != Status.RevisionRequested) {
            revert InvalidStatus(escrow.status);
        }

        escrow.status = Status.Submitted;
        emit WorkSubmitted(escrowId, msg.sender);
    }

    function requestRevision(uint256 escrowId) external whenNotPaused {
        Escrow storage escrow = _getEscrow(escrowId);
        if (msg.sender != escrow.client) revert UnauthorizedParticipant();
        if (escrow.status != Status.Submitted) revert InvalidStatus(escrow.status);

        escrow.status = Status.RevisionRequested;
        escrow.revisionCount++;
        emit RevisionRequested(escrowId, msg.sender, escrow.revisionCount);
    }

    function raiseDispute(uint256 escrowId) external whenNotPaused {
        Escrow storage escrow = _getEscrow(escrowId);
        if (msg.sender != escrow.client && msg.sender != escrow.freelancer) revert UnauthorizedParticipant();
        if (
            escrow.status != Status.Funded && escrow.status != Status.Submitted
                && escrow.status != Status.RevisionRequested
        ) revert InvalidStatus(escrow.status);

        escrow.status = Status.Disputed;
        emit DisputeRaised(escrowId, msg.sender);
    }

    function release(uint256 escrowId) external whenNotPaused nonReentrant {
        Escrow storage escrow = _getEscrow(escrowId);
        if (msg.sender != escrow.client) revert UnauthorizedParticipant();
        if (escrow.status != Status.Submitted) revert InvalidStatus(escrow.status);
        _release(escrowId, escrow);
    }

    function claimTimeoutRefund(uint256 escrowId) external whenNotPaused nonReentrant {
        Escrow storage escrow = _getEscrow(escrowId);
        if (msg.sender != escrow.client) revert UnauthorizedParticipant();
        if (escrow.status != Status.Funded) revert InvalidStatus(escrow.status);
        if (block.timestamp <= escrow.deadline) revert DeadlineNotReached();
        _refund(escrowId, escrow);
    }

    function resolveDispute(uint256 escrowId, bool releaseToFreelancer)
        external
        onlyRole(ARBITER_ROLE)
        whenNotPaused
        nonReentrant
    {
        Escrow storage escrow = _getEscrow(escrowId);
        if (escrow.status != Status.Disputed) revert InvalidStatus(escrow.status);

        if (releaseToFreelancer) {
            _release(escrowId, escrow);
        } else {
            _refund(escrowId, escrow);
        }
        emit DisputeResolved(escrowId, releaseToFreelancer);
    }

    function setFeeRecipient(address newRecipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newRecipient == address(0)) revert InvalidAddress();
        address previousRecipient = feeRecipient;
        feeRecipient = newRecipient;
        emit FeeRecipientUpdated(previousRecipient, newRecipient);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function _release(uint256 escrowId, Escrow storage escrow) private {
        escrow.status = Status.Released;
        uint256 feeAmount = (escrow.amount * FEE_BPS) / BPS_DENOMINATOR;
        uint256 freelancerAmount = escrow.amount - feeAmount;

        paymentToken.safeTransfer(escrow.freelancer, freelancerAmount);
        if (feeAmount != 0) paymentToken.safeTransfer(feeRecipient, feeAmount);

        emit EscrowReleased(escrowId, freelancerAmount, feeAmount);
    }

    function _refund(uint256 escrowId, Escrow storage escrow) private {
        escrow.status = Status.Refunded;
        paymentToken.safeTransfer(escrow.client, escrow.amount);
        emit EscrowRefunded(escrowId, escrow.client, escrow.amount);
    }

    function _getEscrow(uint256 escrowId) private view returns (Escrow storage escrow) {
        escrow = escrows[escrowId];
        if (escrow.status == Status.None) revert InvalidEscrow();
    }
}
