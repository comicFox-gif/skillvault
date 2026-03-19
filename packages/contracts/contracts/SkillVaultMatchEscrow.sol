// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract SkillVaultMatchEscrow {
    enum Status { Created, Joined, Funded, ResultProposed, Disputed, Resolved, Cancelled }

    struct Match {
        address creator;
        address opponent;      // can be zero for open match
        uint256 stake;         // per player
        address token;         // for now address(0) = ETH
        uint64  createdAt;
        uint64  joinedAt;
        uint64  joinBy;        // deadline to join
        uint64  confirmBy;     // deadline to confirm result (initially stores duration)
        Status status;

        bool creatorPaid;
        bool opponentPaid;

        address proposedWinner; // set when proposed
    }

    mapping(uint256 => Match) public matches;
    mapping(uint256 => address) public creatorReportedWinner;
    mapping(uint256 => address) public opponentReportedWinner;
    mapping(uint256 => address) public resolvedWinner;
    uint256 public nextMatchId;
    address public treasury;
    address public admin;
    uint256 public constant FEE_BPS = 200; // 2%

    event MatchCreated(uint256 indexed matchId, address indexed creator, address indexed opponent, uint256 stake);
    event MatchJoined(uint256 indexed matchId, address indexed opponent);
    event Deposited(uint256 indexed matchId, address indexed player, uint256 amount);
    event WinnerProposed(uint256 indexed matchId, address indexed proposedWinner);
    event WinnerConfirmed(uint256 indexed matchId, address indexed winner, uint256 payout, uint256 fee);
    event Forfeited(uint256 indexed matchId, address indexed loser, address indexed winner);
    event Disputed(uint256 indexed matchId);
    event Resolved(uint256 indexed matchId, address winnerOrZero, uint256 payoutOrRefund);
    event Cancelled(uint256 indexed matchId);
    event ProposalExpired(uint256 indexed matchId);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    constructor(address _treasury) {
        require(_treasury != address(0), "Invalid treasury");
        admin = msg.sender;
        treasury = _treasury;
    }

    function createMatch(
        address _opponent,
        uint256 _stake,
        uint64 _joinWindowSeconds,
        uint64 _confirmWindowSeconds
    ) external payable returns (uint256) {
        require(_stake > 0, "Stake must be > 0");
        require(_joinWindowSeconds > 0, "Join window must be > 0");
        require(_confirmWindowSeconds > 0, "Confirm window must be > 0");
        require(msg.value == _stake, "Incorrect stake");
        uint256 matchId = nextMatchId++;

        Match storage m = matches[matchId];
        m.creator = msg.sender;
        m.opponent = _opponent;
        m.stake = _stake;
        m.token = address(0);
        m.createdAt = uint64(block.timestamp);
        m.joinedAt = 0;
        m.joinBy = uint64(block.timestamp) + _joinWindowSeconds;
        m.confirmBy = _confirmWindowSeconds; // Store duration temporarily
        m.status = Status.Created;
        m.creatorPaid = true;
        m.opponentPaid = false;
        m.proposedWinner = address(0);
        creatorReportedWinner[matchId] = address(0);
        opponentReportedWinner[matchId] = address(0);
        resolvedWinner[matchId] = address(0);

        emit MatchCreated(matchId, msg.sender, _opponent, _stake);
        emit Deposited(matchId, msg.sender, msg.value);
        return matchId;
    }

    function joinMatch(uint256 _matchId) external payable {
        Match storage m = matches[_matchId];
        require(m.status == Status.Created, "Not created");
        require(block.timestamp <= m.joinBy, "Join deadline passed");
        require(msg.value == m.stake, "Incorrect stake");
        
        if (m.opponent != address(0)) {
            require(msg.sender == m.opponent, "Not opponent");
        } else {
            m.opponent = msg.sender;
        }

        m.status = Status.Joined;
        m.joinedAt = uint64(block.timestamp);
        m.opponentPaid = true;
        emit MatchJoined(_matchId, msg.sender);

        emit Deposited(_matchId, msg.sender, msg.value);

        if (m.creatorPaid && m.opponentPaid) {
            m.status = Status.Funded;
        }
    }

    function proposeWinner(uint256 _matchId, address _winner) external {
        Match storage m = matches[_matchId];
        require(m.status == Status.Funded || m.status == Status.ResultProposed, "Cannot report result");
        require(msg.sender == m.creator || msg.sender == m.opponent, "Not player");
        require(_winner == m.creator || _winner == m.opponent, "Invalid winner");

        if (m.status == Status.Funded) {
            m.status = Status.ResultProposed;
            m.confirmBy = uint64(block.timestamp + m.confirmBy); // convert stored duration into absolute deadline
        } else {
            require(block.timestamp <= m.confirmBy, "Confirm deadline passed");
        }

        if (msg.sender == m.creator) {
            creatorReportedWinner[_matchId] = _winner;
        } else {
            opponentReportedWinner[_matchId] = _winner;
        }

        m.proposedWinner = _winner;

        emit WinnerProposed(_matchId, _winner);

        // If a player reports themselves as loser, settle immediately.
        if (_winner != msg.sender) {
            _payout(_matchId, _winner);
            return;
        }

        _tryAutoSettle(_matchId, m);
    }

    function confirmWinner(uint256 _matchId) external {
        Match storage m = matches[_matchId];
        require(m.status == Status.ResultProposed, "No result proposed");
        require(block.timestamp <= m.confirmBy, "Confirm deadline passed");
        require(msg.sender == m.creator || msg.sender == m.opponent, "Not player");
        require(m.proposedWinner != address(0), "No winner selected");
        require(msg.sender != m.proposedWinner, "Winner cannot confirm");

        if (msg.sender == m.creator) {
            creatorReportedWinner[_matchId] = m.proposedWinner;
        } else {
            opponentReportedWinner[_matchId] = m.proposedWinner;
        }

        _tryAutoSettle(_matchId, m);
    }

    function forfeit(uint256 _matchId) external {
        Match storage m = matches[_matchId];
        require(
            m.status == Status.Funded || m.status == Status.ResultProposed || m.status == Status.Disputed,
            "Cannot forfeit"
        );
        require(msg.sender == m.creator || msg.sender == m.opponent, "Not player");

        address winner = msg.sender == m.creator ? m.opponent : m.creator;
        require(winner != address(0), "Opponent missing");
        m.proposedWinner = winner;

        emit Forfeited(_matchId, msg.sender, winner);
        _payout(_matchId, winner);
    }

    function dispute(uint256 _matchId) external {
        Match storage m = matches[_matchId];
        require(m.status == Status.ResultProposed || m.status == Status.Funded, "Cannot dispute");
        require(msg.sender == m.creator || msg.sender == m.opponent, "Not player");
        
        m.status = Status.Disputed;
        emit Disputed(_matchId);
    }

    function concedeDispute(uint256 _matchId) external {
        Match storage m = matches[_matchId];
        require(m.status == Status.Disputed, "Not disputed");
        require(msg.sender == m.creator || msg.sender == m.opponent, "Not player");

        address winner = msg.sender == m.creator ? m.opponent : m.creator;
        require(winner != address(0), "Opponent missing");

        m.proposedWinner = winner;
        emit Forfeited(_matchId, msg.sender, winner);
        _payout(_matchId, winner);
    }

    function resolveProposalTimeout(uint256 _matchId) external {
        Match storage m = matches[_matchId];
        require(m.status == Status.ResultProposed, "No result proposed");
        require(block.timestamp > m.confirmBy, "Confirm window active");
        m.status = Status.Disputed;
        emit ProposalExpired(_matchId);
        emit Disputed(_matchId);
    }

    function finalizeResultAfterTimeout(uint256 _matchId) external {
        Match storage m = matches[_matchId];
        require(m.status == Status.ResultProposed, "No result proposed");
        require(block.timestamp > m.confirmBy, "Confirm window active");

        address creatorVote = creatorReportedWinner[_matchId];
        address opponentVote = opponentReportedWinner[_matchId];

        if (creatorVote != address(0) && opponentVote == address(0)) {
            m.proposedWinner = creatorVote;
            _payout(_matchId, creatorVote);
            return;
        }

        if (opponentVote != address(0) && creatorVote == address(0)) {
            m.proposedWinner = opponentVote;
            _payout(_matchId, opponentVote);
            return;
        }

        if (creatorVote != address(0) && creatorVote == opponentVote) {
            m.proposedWinner = creatorVote;
            _payout(_matchId, creatorVote);
            return;
        }

        m.proposedWinner = address(0);
        m.status = Status.Disputed;
        emit ProposalExpired(_matchId);
        emit Disputed(_matchId);
    }

    function adminResolve(uint256 _matchId, address _winner, bool _refund) external onlyAdmin {
        Match storage m = matches[_matchId];
        // Admin can resolve if Disputed, or if ResultProposed (e.g. timeout), or even Funded (stuck)
        require(m.status == Status.Disputed || m.status == Status.ResultProposed || m.status == Status.Funded, "Invalid state");

        if (_refund) {
            m.status = Status.Resolved;
            resolvedWinner[_matchId] = address(0);
            uint256 refundAmount = m.stake;
            
            if (m.creatorPaid) _safeTransfer(m.creator, refundAmount, "Creator refund failed");
            if (m.opponentPaid) _safeTransfer(m.opponent, refundAmount, "Opponent refund failed");
            
            emit Resolved(_matchId, address(0), 0);
        } else {
            require(_winner == m.creator || _winner == m.opponent, "Invalid winner");
            _payout(_matchId, _winner);
        }
    }

    function cancel(uint256 _matchId) external {
        Match storage m = matches[_matchId];
        if (m.status == Status.Created) {
            require(msg.sender == m.creator, "Only creator");
        } else if (m.status == Status.Joined || m.status == Status.Funded) {
            require(msg.sender == m.creator || msg.sender == m.opponent, "Only players");
            require(m.joinedAt != 0 && block.timestamp <= m.joinedAt + 60, "Cancel window passed");
        } else {
            revert("Cannot cancel");
        }
        
        m.status = Status.Cancelled;

        if (m.creatorPaid) _safeTransfer(m.creator, m.stake, "Creator refund failed");
        if (m.opponentPaid) _safeTransfer(m.opponent, m.stake, "Opponent refund failed");
        
        emit Cancelled(_matchId);
    }

    function _payout(uint256 _matchId, address _winner) internal {
        Match storage m = matches[_matchId];
        m.status = Status.Resolved;
        resolvedWinner[_matchId] = _winner;
        
        uint256 totalPot = m.stake * 2;
        uint256 fee = (totalPot * FEE_BPS) / 10000;
        uint256 payout = totalPot - fee;

        _safeTransfer(treasury, fee, "Fee transfer failed");
        _safeTransfer(_winner, payout, "Payout failed");

        emit WinnerConfirmed(_matchId, _winner, payout, fee);
        emit Resolved(_matchId, _winner, payout);
    }

    function _tryAutoSettle(uint256 _matchId, Match storage m) internal {
        address creatorVote = creatorReportedWinner[_matchId];
        address opponentVote = opponentReportedWinner[_matchId];
        if (creatorVote == address(0) || opponentVote == address(0)) {
            return;
        }
        if (creatorVote != opponentVote) {
            m.proposedWinner = address(0);
            return;
        }

        m.proposedWinner = creatorVote;
        _payout(_matchId, creatorVote);
    }

    function _safeTransfer(address _to, uint256 _amount, string memory _error) internal {
        (bool success, ) = payable(_to).call{value: _amount}("");
        require(success, _error);
    }

    function getMatch(uint256 _matchId) external view returns (
        address creator,
        address opponent,
        uint256 stake,
        uint64 joinedAt,
        uint8 status,
        bool creatorPaid,
        bool opponentPaid,
        address proposedWinner
    ) {
        Match storage m = matches[_matchId];
        return (
            m.creator,
            m.opponent,
            m.stake,
            m.joinedAt,
            uint8(m.status),
            m.creatorPaid,
            m.opponentPaid,
            m.proposedWinner
        );
    }
}
