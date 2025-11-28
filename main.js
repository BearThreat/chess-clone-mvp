/* Chess MVP - click-to-move with full legal validation (castling, en passant, promotion) */
(() => {
    // DOM
    const boardEl = document.getElementById("board");
    const turnText = document.getElementById("turnText");
    const stateText = document.getElementById("stateText");
    const newGameBtn = document.getElementById("newGameBtn");
    const promoModal = document.getElementById("promotionModal");
    const cancelPromoBtn = document.getElementById("cancelPromoBtn");

    // Constants
    const WHITE = "w";
    const BLACK = "b";

    // Starting squares (0 = a8 .. 63 = h1)
    const A8 = 0, H8 = 7, A1 = 56, H1 = 63, E8 = 4, E1 = 60, A8R = 0, H8R = 7, A1R = 56, H1R = 63;

    // Piece glyphs (Unicode) - using filled glyphs for both sides
    const GLYPHS = {
        k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟"
    };

    // Directions for sliding pieces
    const DIRS_BISHOP = [-9, -7, 7, 9];
    const DIRS_ROOK = [-8, -1, 1, 8];
    const DIRS_QUEEN = [...DIRS_BISHOP, ...DIRS_ROOK];

    // State
    const S = {
        board: new Array(64).fill(null), // null or {t:'p/r/n/b/q/k', c:'w/b'}
        turn: WHITE,
        // Castling rights
        wk: true, wq: true, bk: true, bq: true,
        enPassant: null, // square index target for EP capture landing
        halfmove: 0,
        fullmove: 1,
        selected: null, // from square index
        legalMovesForSelected: [], // array of move objects
        squares: [], // DOM .square nodes
        pendingPromotion: null, // {move}
    };

    // Utilities -------------------------------------------------------------

    function idxToRF(i) {
        // rank 0..7 (top->bottom), file 0..7 (left->right)
        return { r: Math.floor(i / 8), f: i % 8 };
    }

    function rfToIdx(r, f) {
        if (r < 0 || r > 7 || f < 0 || f > 7) return -1;
        return r * 8 + f;
    }

    function sameColor(a, b) {
        return a && b && a.c === b.c;
    }

    function opposite(color) {
        return color === WHITE ? BLACK : WHITE;
    }

    function cloneStateBasics(src) {
        const dst = {
            board: src.board.map(p => (p ? { t: p.t, c: p.c } : null)),
            turn: src.turn,
            wk: src.wk,
            wq: src.wq,
            bk: src.bk,
            bq: src.bq,
            enPassant: src.enPassant,
            halfmove: src.halfmove,
            fullmove: src.fullmove,
        };
        return dst;
    }

    // Rendering -------------------------------------------------------------

    function buildBoardSquares() {
        boardEl.innerHTML = "";
        S.squares = [];
        for (let i = 0; i < 64; i++) {
            const { r, f } = idxToRF(i);
            const sq = document.createElement("div");
            sq.className = "square " + (((r + f) % 2 === 0) ? "light" : "dark");
            sq.setAttribute("role", "gridcell");
            sq.setAttribute("data-index", String(i));
            sq.addEventListener("click", onSquareClick);
            S.squares.push(sq);
            boardEl.appendChild(sq);
        }
    }

    function renderBoard() {
        // Clear classes and set glyphs
        for (let i = 0; i < 64; i++) {
            const el = S.squares[i];
            el.classList.remove("selected", "legal", "capture", "in-check", "piece", "w", "b");
            const p = S.board[i];
            if (p) {
                el.textContent = GLYPHS[p.t];
                el.classList.add("piece", p.c);
            } else {
                el.textContent = "";
            }
        }
        if (S.selected != null) {
            S.squares[S.selected].classList.add("selected");
            for (const m of S.legalMovesForSelected) {
                const targetEl = S.squares[m.to];
                const isCap = !!m.capture;
                targetEl.classList.add(isCap ? "capture" : "legal");
            }
        }
        // Highlight king of side to move if in check
        const color = S.turn;
        const kingSq = findKing(S, color);
        if (kingSq != null) {
            if (isSquareAttacked(S, kingSq, opposite(color))) {
                S.squares[kingSq].classList.add("in-check");
            }
        }

        // Header/status
        turnText.textContent = S.turn === WHITE ? "White" : "Black";
        stateText.textContent = getStatusText(S);
    }

    function getStatusText(state) {
        const color = state.turn;
        const moves = allLegalMoves(state, color);
        const inCheckNow = isSquareAttacked(state, findKing(state, color), opposite(color));
        if (moves.length === 0) {
            if (inCheckNow) return `Checkmate — ${color === WHITE ? "Black" : "White"} wins`;
            return "Stalemate";
        }
        if (inCheckNow) return "Check";
        return "";
    }

    // Input handling --------------------------------------------------------

    function onSquareClick(e) {
        if (S.pendingPromotion) return; // lock input during promotion
        const idx = Number(e.currentTarget.getAttribute("data-index"));
        const clickedPiece = S.board[idx];

        if (S.selected == null) {
            // Select if it's current side to move
            if (clickedPiece && clickedPiece.c === S.turn) {
                S.selected = idx;
                // Only select if it has legal moves? No, traditional to select anyway.
                S.selected = idx;
                S.legalMovesForSelected = legalMovesForSquare(S, idx);
            }
        } else {
            // If clicked same color piece, reselect
            const from = S.selected;
            const legal = S.legalMovesForSelected;
            const match = legal.find((m) => m.to === idx);
            if (match) {
                tryMoveOrPromote(match);
            } else if (clickedPiece && clickedPiece.c === S.turn) {
                // Reselect to new piece
                S.selected = idx;
                S.legalMovesForSelected = legalMovesForSquare(S, idx);
            } else {
                // clear selection
                S.selected = null;
                S.legalMovesForSelected = [];
            }
        }
        renderBoard();
    }

    function tryMoveOrPromote(move) {
        // If promotion needed (pawn reaching last rank)
        const piece = S.board[move.from];
        if (piece && piece.t === "p") {
            const { r } = idxToRF(move.to);
            if ((piece.c === WHITE && r === 0) || (piece.c === BLACK && r === 7)) {
                // show promotion modal
                S.pendingPromotion = { move };
                showPromotionModal();
                return;
            }
        }
        // Otherwise execute
        executeMoveAndAdvance(S, move);
        S.selected = null;
        S.legalMovesForSelected = [];
    }

    function showPromotionModal() {
        promoModal.classList.remove("hidden");
        promoModal.setAttribute("aria-hidden", "false");
    }

    function hidePromotionModal() {
        promoModal.classList.add("hidden");
        promoModal.setAttribute("aria-hidden", "true");
    }

    function onChoosePromotion(pieceLetter) {
        if (!S.pendingPromotion) return;
        const move = { ...S.pendingPromotion.move, promo: pieceLetter };
        S.pendingPromotion = null;
        hidePromotionModal();
        executeMoveAndAdvance(S, move);
        S.selected = null;
        S.legalMovesForSelected = [];
        renderBoard();
    }

    // Move generation (pseudolegal + legality filter) ----------------------

    function legalMovesForSquare(state, from) {
        const piece = state.board[from];
        if (!piece || piece.c !== state.turn) return [];
        const pseudo = generatePseudoMoves(state, from, piece);
        // Filter by legality (own king not in check after move)
        const out = [];
        for (const m of pseudo) {
            const s2 = cloneStateBasics(state);
            applyMoveInPlace(s2, m);
            const kSq = findKing(s2, piece.c);
            if (!isSquareAttacked(s2, kSq, opposite(piece.c))) {
                out.push(m);
            }
        }
        return out;
    }

    function allLegalMoves(state, color) {
        const out = [];
        for (let i = 0; i < 64; i++) {
            const p = state.board[i];
            if (p && p.c === color) {
                const pseudo = generatePseudoMoves(state, i, p);
                for (const m of pseudo) {
                    const s2 = cloneStateBasics(state);
                    applyMoveInPlace(s2, m);
                    const kSq = findKing(s2, color);
                    if (!isSquareAttacked(s2, kSq, opposite(color))) {
                        out.push(m);
                    }
                }
            }
        }
        return out;
    }

    function generatePseudoMoves(state, from, piece) {
        switch (piece.t) {
            case "p": return genPawnMoves(state, from, piece.c);
            case "n": return genKnightMoves(state, from, piece.c);
            case "b": return genSlidingMoves(state, from, piece.c, DIRS_BISHOP);
            case "r": return genSlidingMoves(state, from, piece.c, DIRS_ROOK);
            case "q": return genSlidingMoves(state, from, piece.c, DIRS_QUEEN);
            case "k": return genKingMoves(state, from, piece.c);
        }
        return [];
    }

    function genPawnMoves(state, from, color) {
        const moves = [];
        const { r, f } = idxToRF(from);
        const dir = color === WHITE ? -1 : 1;
        const startRank = color === WHITE ? 6 : 1;
        const oneR = r + dir;
        const one = rfToIdx(oneR, f);
        // one step
        if (one >= 0 && state.board[one] == null) {
            moves.push({ from, to: one, piece: "p" });
            // two steps from start if clear
            if (r === startRank) {
                const two = rfToIdx(r + 2 * dir, f);
                if (two >= 0 && state.board[two] == null) {
                    moves.push({ from, to: two, piece: "p", twoPush: true });
                }
            }
        }
        // captures
        for (const df of [-1, 1]) {
            const tf = f + df;
            const tr = r + dir;
            const to = rfToIdx(tr, tf);
            if (to >= 0) {
                const target = state.board[to];
                if (target && target.c !== color) {
                    moves.push({ from, to, piece: "p", capture: target });
                } else if (state.enPassant === to) {
                    // en passant capture
                    moves.push({ from, to, piece: "p", isEnPassant: true });
                }
            }
        }
        return moves;
    }

    function genKnightMoves(state, from, color) {
        const offsets = [-17, -15, -10, -6, 6, 10, 15, 17];
        const moves = [];
        const { r, f } = idxToRF(from);
        for (const off of offsets) {
            const to = from + off;
            if (to < 0 || to > 63) continue;
            const { r: r2, f: f2 } = idxToRF(to);
            if (Math.max(Math.abs(r2 - r), Math.abs(f2 - f)) > 2) continue; // quick bounds
            const target = state.board[to];
            if (!target) moves.push({ from, to, piece: "n" });
            else if (target.c !== color) moves.push({ from, to, piece: "n", capture: target });
        }
        return moves;
    }

    function genSlidingMoves(state, from, color, dirs) {
        const moves = [];
        for (const d of dirs) {
            let cur = from;
            while (true) {
                const prev = cur;
                cur += d;
                if (cur < 0 || cur > 63) break;
                if (!isSameLine(prev, cur, d)) break; // prevent wrap on files
                const target = state.board[cur];
                if (!target) {
                    moves.push({ from, to: cur, piece: state.board[from].t });
                } else {
                    if (target.c !== color) {
                        moves.push({ from, to: cur, piece: state.board[from].t, capture: target });
                    }
                    break;
                }
            }
        }
        return moves;
    }

    function isSameLine(a, b, d) {
        // Ensure we haven't wrapped files when moving horizontally/diagonally.
        const { r: ra, f: fa } = idxToRF(a);
        const { r: rb, f: fb } = idxToRF(b);
        if (d === -1 || d === 1) return ra === rb; // same rank for horizontal
        if (d === -9 || d === 9) return Math.abs(rb - ra) === Math.abs(fb - fa) && (fb - fa) === (d > 0 ? 1 : -1);
        if (d === -7 || d === 7) return Math.abs(rb - ra) === Math.abs(fb - fa) && (fb - fa) === (d > 0 ? -1 : 1);
        if (d === -8 || d === 8) return fb === fa; // same file for vertical
        // For knight or others, not used here
        return true;
    }

    function genKingMoves(state, from, color) {
        const moves = [];
        const steps = [-9, -8, -7, -1, 1, 7, 8, 9];
        const { r, f } = idxToRF(from);
        for (const s of steps) {
            const to = from + s;
            if (to < 0 || to > 63) continue;
            const { r: r2, f: f2 } = idxToRF(to);
            if (Math.max(Math.abs(r2 - r), Math.abs(f2 - f)) > 1) continue;
            const target = state.board[to];
            if (!target) moves.push({ from, to, piece: "k" });
            else if (target.c !== color) moves.push({ from, to, piece: "k", capture: target });
        }
        // Castling
        if (color === WHITE && from === E1) {
            if (state.wk && canCastleKingSide(state, WHITE)) {
                moves.push({ from, to: 62, piece: "k", isCastle: "K" }); // g1
            }
            if (state.wq && canCastleQueenSide(state, WHITE)) {
                moves.push({ from, to: 58, piece: "k", isCastle: "Q" }); // c1
            }
        } else if (color === BLACK && from === E8) {
            if (state.bk && canCastleKingSide(state, BLACK)) {
                moves.push({ from, to: 6, piece: "k", isCastle: "K" }); // g8
            }
            if (state.bq && canCastleQueenSide(state, BLACK)) {
                moves.push({ from, to: 2, piece: "k", isCastle: "Q" }); // c8
            }
        }
        return moves;
    }

    function canCastleKingSide(state, color) {
        if (isSquareAttacked(state, findKing(state, color), opposite(color))) return false;
        if (color === WHITE) {
            // squares f1 (61), g1 (62) empty and not attacked, rook at h1 (63)
            if (state.board[61] || state.board[62]) return false;
            if (isSquareAttacked(state, 61, opposite(color))) return false;
            if (isSquareAttacked(state, 62, opposite(color))) return false;
            const rook = state.board[H1R];
            if (!rook || rook.t !== "r" || rook.c !== WHITE) return false;
            return true;
        } else {
            // f8 (5), g8 (6)
            if (state.board[5] || state.board[6]) return false;
            if (isSquareAttacked(state, 5, opposite(color))) return false;
            if (isSquareAttacked(state, 6, opposite(color))) return false;
            const rook = state.board[H8R];
            if (!rook || rook.t !== "r" || rook.c !== BLACK) return false;
            return true;
        }
    }

    function canCastleQueenSide(state, color) {
        if (isSquareAttacked(state, findKing(state, color), opposite(color))) return false;
        if (color === WHITE) {
            // squares d1 (59), c1 (58), b1 (57) empty; d1,c1 not attacked; rook at a1 (56)
            if (state.board[59] || state.board[58] || state.board[57]) return false;
            if (isSquareAttacked(state, 59, opposite(color))) return false;
            if (isSquareAttacked(state, 58, opposite(color))) return false;
            const rook = state.board[A1R];
            if (!rook || rook.t !== "r" || rook.c !== WHITE) return false;
            return true;
        } else {
            // d8 (3), c8 (2), b8 (1)
            if (state.board[3] || state.board[2] || state.board[1]) return false;
            if (isSquareAttacked(state, 3, opposite(color))) return false;
            if (isSquareAttacked(state, 2, opposite(color))) return false;
            const rook = state.board[A8R];
            if (!rook || rook.t !== "r" || rook.c !== BLACK) return false;
            return true;
        }
    }

    // Attack detection ------------------------------------------------------

    function isSquareAttacked(state, sq, byColor) {
        if (sq == null) return false;

        // Pawn attacks
        const { r, f } = idxToRF(sq);
        const dir = byColor === WHITE ? -1 : 1;
        for (const df of [-1, 1]) {
            const a = rfToIdx(r + dir, f + df);
            if (a >= 0) {
                const p = state.board[a];
                if (p && p.c === byColor && p.t === "p") return true;
            }
        }

        // Knights
        const KOFF = [-17, -15, -10, -6, 6, 10, 15, 17];
        for (const off of KOFF) {
            const to = sq + off;
            if (to < 0 || to > 63) continue;
            const { r: ra, f: fa } = idxToRF(sq);
            const { r: rb, f: fb } = idxToRF(to);
            if (Math.max(Math.abs(rb - ra), Math.abs(fb - fa)) > 2) continue;
            const p = state.board[to];
            if (p && p.c === byColor && p.t === "n") return true;
        }

        // Sliding bishops/queens
        if (rayAttack(state, sq, byColor, DIRS_BISHOP, ["b", "q"])) return true;
        // Sliding rooks/queens
        if (rayAttack(state, sq, byColor, DIRS_ROOK, ["r", "q"])) return true;

        // King adjacency
        const steps = [-9, -8, -7, -1, 1, 7, 8, 9];
        for (const s of steps) {
            const to = sq + s;
            if (to < 0 || to > 63) continue;
            const { r: ra, f: fa } = idxToRF(sq);
            const { r: rb, f: fb } = idxToRF(to);
            if (Math.max(Math.abs(rb - ra), Math.abs(fb - fa)) > 1) continue;
            const p = state.board[to];
            if (p && p.c === byColor && p.t === "k") return true;
        }

        return false;
    }

    function rayAttack(state, sq, byColor, dirs, types) {
        for (const d of dirs) {
            let cur = sq;
            while (true) {
                const prev = cur;
                cur += d;
                if (cur < 0 || cur > 63) break;
                if (!isSameLine(prev, cur, d)) break;
                const p = state.board[cur];
                if (!p) continue;
                if (p.c !== byColor) break;
                if (types.includes(p.t)) return true;
                break;
            }
        }
        return false;
    }

    function findKing(state, color) {
        for (let i = 0; i < 64; i++) {
            const p = state.board[i];
            if (p && p.c === color && p.t === "k") return i;
        }
        return null;
    }

    // Move application ------------------------------------------------------

    function applyMoveInPlace(state, move) {
        const fromP = state.board[move.from];
        const toP = state.board[move.to];

        // Update halfmove clock
        if (fromP.t === "p" || toP) state.halfmove = 0;
        else state.halfmove++;

        // Reset enPassant
        let newEnPassant = null;

        // Handle special: en passant capture
        if (move.isEnPassant && fromP.t === "p") {
            const { r: tr, f: tf } = idxToRF(move.to);
            const capR = tr + (fromP.c === WHITE ? 1 : -1);
            const capSq = rfToIdx(capR, tf);
            state.board[capSq] = null;
        }

        // Handle castling rook move
        if (fromP.t === "k" && move.isCastle) {
            if (fromP.c === WHITE) {
                if (move.isCastle === "K") {
                    // Move rook h1->f1 (63->61)
                    state.board[61] = state.board[63];
                    state.board[63] = null;
                } else {
                    // a1->d1 (56->59)
                    state.board[59] = state.board[56];
                    state.board[56] = null;
                }
            } else {
                if (move.isCastle === "K") {
                    // h8->f8 (7->5)
                    state.board[5] = state.board[7];
                    state.board[7] = null;
                } else {
                    // a8->d8 (0->3)
                    state.board[3] = state.board[0];
                    state.board[0] = null;
                }
            }
        }

        // Move piece
        state.board[move.to] = fromP ? { t: fromP.t, c: fromP.c } : null;
        state.board[move.from] = null;

        // Handle promotion
        if (move.promo && fromP.t === "p") {
            state.board[move.to].t = move.promo; // 'q','r','b','n'
        }

        // Set enPassant after a two-square pawn push
        if (fromP.t === "p" && move.twoPush) {
            const { r: fr, f: ff } = idxToRF(move.from);
            const passed = rfToIdx(fr + (fromP.c === WHITE ? -1 : 1), ff);
            newEnPassant = passed;
        }

        // Update castling rights on king/rook moves or rook capture
        if (fromP.t === "k") {
            if (fromP.c === WHITE) {
                state.wk = false; state.wq = false;
            } else {
                state.bk = false; state.bq = false;
            }
        }
        if (fromP.t === "r") {
            if (fromP.c === WHITE) {
                if (move.from === H1R) state.wk = false;
                if (move.from === A1R) state.wq = false;
            } else {
                if (move.from === H8R) state.bk = false;
                if (move.from === A8R) state.bq = false;
            }
        }
        // If a rook is captured on its original square, update rights
        if (toP && toP.t === "r") {
            if (toP.c === WHITE) {
                if (move.to === H1R) state.wk = false;
                if (move.to === A1R) state.wq = false;
            } else {
                if (move.to === H8R) state.bk = false;
                if (move.to === A8R) state.bq = false;
            }
        }

        state.enPassant = newEnPassant;

        // Turn + fullmove
        state.turn = opposite(state.turn);
        if (state.turn === WHITE) state.fullmove++;
    }

    function executeMoveAndAdvance(state, move) {
        applyMoveInPlace(state, move);
        // After move, update UI and check terminal states (handled in renderBoard)
        renderBoard();
    }

    // Game setup ------------------------------------------------------------

    function setupInitialPosition() {
        S.board.fill(null);
        // Black back rank
        const backB = [
            { t: "r", c: BLACK }, { t: "n", c: BLACK }, { t: "b", c: BLACK }, { t: "q", c: BLACK },
            { t: "k", c: BLACK }, { t: "b", c: BLACK }, { t: "n", c: BLACK }, { t: "r", c: BLACK },
        ];
        for (let f = 0; f < 8; f++) S.board[rfToIdx(0, f)] = backB[f];
        // Black pawns
        for (let f = 0; f < 8; f++) S.board[rfToIdx(1, f)] = { t: "p", c: BLACK };
        // White pawns
        for (let f = 0; f < 8; f++) S.board[rfToIdx(6, f)] = { t: "p", c: WHITE };
        // White back rank
        const backW = [
            { t: "r", c: WHITE }, { t: "n", c: WHITE }, { t: "b", c: WHITE }, { t: "q", c: WHITE },
            { t: "k", c: WHITE }, { t: "b", c: WHITE }, { t: "n", c: WHITE }, { t: "r", c: WHITE },
        ];
        for (let f = 0; f < 8; f++) S.board[rfToIdx(7, f)] = backW[f];

        S.turn = WHITE;
        S.wk = S.wq = S.bk = S.bq = true;
        S.enPassant = null;
        S.halfmove = 0;
        S.fullmove = 1;
        S.selected = null;
        S.legalMovesForSelected = [];
        S.pendingPromotion = null;
    }

    function newGame() {
        setupInitialPosition();
        renderBoard();
    }

    // Promotion buttons wiring
    function wirePromotionButtons() {
        const buttons = promoModal.querySelectorAll(".promo-btn");
        buttons.forEach(btn => {
            btn.addEventListener("click", () => {
                const letter = btn.getAttribute("data-piece"); // q r b n
                onChoosePromotion(letter);
            });
        });
        cancelPromoBtn.addEventListener("click", () => {
            S.pendingPromotion = null;
            hidePromotionModal();
            renderBoard();
        });
    }

    // Initialize ------------------------------------------------------------

    function init() {
        buildBoardSquares();
        wirePromotionButtons();
        newGameBtn.addEventListener("click", newGame);
        newGame();
    }

    // Boot
    init();
})();
