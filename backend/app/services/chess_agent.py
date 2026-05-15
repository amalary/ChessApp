from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Callable, Literal, TypedDict, cast

import chess
from langchain_core.runnables import RunnableLambda
from langgraph.graph import END, START, StateGraph

from app.services.assistant_personality import (
    AssistantConversationMode,
    apply_personality,
    normalize_conversation_mode,
)
from app.services.coaching_memory import (
    build_conversational_memory,
    build_emotional_context,
    build_memory_reference,
)

APP_FEATURE_HELP = {
    "analytics": "Analytics shows how clean your solves are and where you leak points.",
    "puzzle lab": "Puzzle Lab lets you train specific tactical patterns on demand.",
    "training": "Training mode is for reps: faster pattern recognition, better conversion.",
    "history": "History keeps your recent puzzles, key themes, and first-move results.",
    "dashboard": "Dashboard gives the quick form check: volume, accuracy, and trend.",
}

ALLOWED_TOOLS = {
    "validate_fen",
    "list_legal_moves",
    "validate_move",
    "get_solver_solution",
    "verify_checkmate",
    "classify_theme",
    "retrieve_user_puzzle_history",
}

APPROVED_THEMES = {
    "back-rank mate",
    "pin",
    "fork",
    "discovered attack",
    "deflection",
    "sacrifice",
    "smothered mate",
    "overloaded defender",
    "mating net",
}

PROMPT_INJECTION_PHRASES = (
    "ignore previous instructions",
    "reveal system prompt",
    "reveal your system prompt",
    "system prompt",
    "bypass guardrails",
    "call hidden tools",
    "print secrets",
    "change your role",
    "developer message",
    "system message",
    "exfiltrate",
    "api key",
    "environment variable",
)

SECRET_PATTERNS = (
    re.compile(r"AUTH0_[A-Z0-9_]+", re.IGNORECASE),
    re.compile(r"API[_-]?KEY", re.IGNORECASE),
    re.compile(r"DATABASE_URL", re.IGNORECASE),
    re.compile(r"SECRET", re.IGNORECASE),
    re.compile(r"BEGIN (?:RSA|OPENSSH|EC) PRIVATE KEY", re.IGNORECASE),
)

MOVE_TOKEN_PATTERN = re.compile(
    r"\b(?:O-O(?:-O)?[+#]?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?)\b"
)

ALLOWED_MODES = {"hint", "explain", "theme", "followup"}
FULL_LINE_REQUEST_PHRASES = (
    "full line",
    "full solution",
    "full answer",
    "show the line",
    "reveal the line",
    "just tell me",
    "give me the answer",
    "give the answer",
    "show the answer",
    "what is the answer",
)


def _contains_any(text: str, options: tuple[str, ...]) -> bool:
    lowered = text.lower()
    return any(option in lowered for option in options)


def _first_move_token(text: str) -> str | None:
    match = MOVE_TOKEN_PATTERN.search(text)
    if not match:
        return None
    return match.group(0)


class ChessAssistantState(TypedDict, total=False):
    user_id: str
    puzzle_id: str | None
    fen: str | None
    solver_move_san: str | None
    solver_line: list[str]
    coaching_stage: int | None
    user_message: str
    requested_mode: Literal["hint", "explain", "theme", "followup"]
    legal_moves: list[str]
    board_valid: bool
    intent: str
    theme_tags: list[str]
    referenced_move: str | None
    response_text: str
    confidence: float
    guardrail_triggered: bool
    guardrail_reason: str | None
    checkmate_verified: bool
    user_puzzle_history: list[dict[str, Any]]
    user_profile_context: dict[str, Any] | None
    coaching_memory: dict[str, Any] | None
    emotional_context: dict[str, Any] | None
    conversation_mode: AssistantConversationMode


@dataclass
class ToolAccessError(Exception):
    tool_name: str


class ChessAssistantAgent:
    def __init__(self) -> None:
        self._hint_writer = RunnableLambda(self._build_hint_text)
        self._explain_writer = RunnableLambda(self._build_explanation_text)
        self._followup_writer = RunnableLambda(self._build_followup_text)
        self._tool_handlers: dict[str, Callable[[dict[str, Any]], Any]] = {
            "validate_fen": self._tool_validate_fen,
            "list_legal_moves": self._tool_list_legal_moves,
            "validate_move": self._tool_validate_move,
            "get_solver_solution": self._tool_get_solver_solution,
            "verify_checkmate": self._tool_verify_checkmate,
            "classify_theme": self._tool_classify_theme,
            "retrieve_user_puzzle_history": self._tool_retrieve_user_puzzle_history,
        }
        self.graph = self._build_graph()

    def run(
        self,
        *,
        user_id: str,
        puzzle_id: str | None,
        fen: str | None,
        solver_move_san: str | None,
        solver_line: list[str] | None,
        coaching_stage: int | None = None,
        user_message: str,
        requested_mode: str,
        conversation_mode: str | None = None,
        user_puzzle_history: list[dict[str, Any]] | None = None,
        user_profile_context: dict[str, Any] | None = None,
    ) -> ChessAssistantState:
        mode = requested_mode.strip().lower() if isinstance(requested_mode, str) else ""
        if mode not in ALLOWED_MODES:
            mode = "followup"
        normalized_conversation_mode = normalize_conversation_mode(conversation_mode)

        initial_state: ChessAssistantState = {
            "user_id": user_id,
            "puzzle_id": (
                puzzle_id.strip()
                if isinstance(puzzle_id, str) and puzzle_id.strip()
                else None
            ),
            "fen": fen.strip() if isinstance(fen, str) and fen.strip() else None,
            "solver_move_san": (
                solver_move_san.strip()
                if isinstance(solver_move_san, str) and solver_move_san.strip()
                else None
            ),
            "solver_line": [
                move.strip()
                for move in (solver_line or [])
                if isinstance(move, str) and move.strip()
            ],
            "coaching_stage": (
                int(coaching_stage)
                if isinstance(coaching_stage, int) and 1 <= int(coaching_stage) <= 5
                else None
            ),
            "user_message": user_message if isinstance(user_message, str) else "",
            "requested_mode": cast(
                Literal["hint", "explain", "theme", "followup"], mode
            ),
            "legal_moves": [],
            "board_valid": False,
            "intent": "",
            "theme_tags": [],
            "referenced_move": None,
            "response_text": "",
            "confidence": 0.0,
            "guardrail_triggered": False,
            "guardrail_reason": None,
            "checkmate_verified": False,
            "user_puzzle_history": user_puzzle_history or [],
            "user_profile_context": (
                user_profile_context if isinstance(user_profile_context, dict) else None
            ),
            "coaching_memory": None,
            "emotional_context": None,
            "conversation_mode": normalized_conversation_mode,
        }
        result = self.graph.invoke(initial_state)
        return cast(ChessAssistantState, result)

    def _build_graph(self):
        workflow = StateGraph(ChessAssistantState)

        workflow.add_node("sanitize_input", self.sanitize_input)
        workflow.add_node("detect_prompt_injection", self.detect_prompt_injection)
        workflow.add_node("classify_intent", self.classify_intent)
        workflow.add_node("load_puzzle_context", self.load_puzzle_context)
        workflow.add_node("build_coaching_context", self.build_coaching_context)
        workflow.add_node("validate_position", self.validate_position)
        workflow.add_node("analyze_position", self.analyze_position)
        workflow.add_node("generate_hint", self.generate_hint)
        workflow.add_node("explain_solution", self.explain_solution)
        workflow.add_node("identify_theme", self.identify_theme)
        workflow.add_node("answer_followup", self.answer_followup)
        workflow.add_node("validate_response", self.validate_response)

        workflow.add_edge(START, "sanitize_input")
        workflow.add_edge("sanitize_input", "detect_prompt_injection")
        workflow.add_conditional_edges(
            "detect_prompt_injection",
            self._route_after_guardrail,
            {
                "blocked": "validate_response",
                "continue": "classify_intent",
            },
        )
        workflow.add_edge("classify_intent", "load_puzzle_context")
        workflow.add_edge("load_puzzle_context", "build_coaching_context")
        workflow.add_edge("build_coaching_context", "validate_position")
        workflow.add_edge("validate_position", "analyze_position")
        workflow.add_conditional_edges(
            "analyze_position",
            self._route_mode,
            {
                "hint": "generate_hint",
                "explain": "explain_solution",
                "theme": "identify_theme",
                "followup": "answer_followup",
                "end": "validate_response",
            },
        )
        workflow.add_edge("generate_hint", "validate_response")
        workflow.add_edge("explain_solution", "validate_response")
        workflow.add_edge("identify_theme", "validate_response")
        workflow.add_edge("answer_followup", "validate_response")
        workflow.add_edge("validate_response", END)

        return workflow.compile()

    def sanitize_input(self, state: ChessAssistantState) -> ChessAssistantState:
        clean_message = " ".join(state.get("user_message", "").split())[:2000]
        clean_mode = state.get("requested_mode", "followup")
        if clean_mode not in ALLOWED_MODES:
            clean_mode = "followup"

        return {
            **state,
            "user_message": clean_message,
            "requested_mode": cast(
                Literal["hint", "explain", "theme", "followup"], clean_mode
            ),
            "solver_move_san": (state.get("solver_move_san") or "").strip() or None,
            "fen": (state.get("fen") or "").strip() or None,
            "solver_line": [move for move in state.get("solver_line", []) if move],
            "coaching_stage": (
                int(state.get("coaching_stage"))
                if isinstance(state.get("coaching_stage"), int)
                and 1 <= int(state.get("coaching_stage")) <= 5
                else None
            ),
            "user_puzzle_history": [
                item
                for item in state.get("user_puzzle_history", [])
                if isinstance(item, dict)
            ],
            "user_profile_context": (
                state.get("user_profile_context")
                if isinstance(state.get("user_profile_context"), dict)
                else None
            ),
            "coaching_memory": (
                state.get("coaching_memory")
                if isinstance(state.get("coaching_memory"), dict)
                else None
            ),
            "emotional_context": (
                state.get("emotional_context")
                if isinstance(state.get("emotional_context"), dict)
                else None
            ),
            "conversation_mode": normalize_conversation_mode(
                cast(str | None, state.get("conversation_mode"))
            ),
        }

    def build_coaching_context(self, state: ChessAssistantState) -> ChessAssistantState:
        memory = build_conversational_memory(
            history=state.get("user_puzzle_history", []),
            user_message=state.get("user_message", ""),
        )
        emotional = build_emotional_context(memory)
        return {
            **state,
            "coaching_memory": memory,
            "emotional_context": emotional,
        }

    def detect_prompt_injection(
        self, state: ChessAssistantState
    ) -> ChessAssistantState:
        combined_text = " ".join(
            [
                state.get("user_message", ""),
                state.get("fen", "") or "",
                state.get("solver_move_san", "") or "",
                " ".join(state.get("solver_line", [])),
            ]
        )

        if _contains_any(combined_text, PROMPT_INJECTION_PHRASES):
            return {
                **state,
                "guardrail_triggered": True,
                "guardrail_reason": "prompt_injection_detected",
                "response_text": "I can help with chess. I won\u2019t follow override or prompt-hacking instructions.",
                "confidence": 1.0,
            }

        requested_tool = self._extract_requested_tool(state.get("user_message", ""))
        if requested_tool and requested_tool not in ALLOWED_TOOLS:
            return {
                **state,
                "guardrail_triggered": True,
                "guardrail_reason": f"tool_not_allowlisted:{requested_tool}",
                "response_text": "I can analyze the position, but only with approved chess-safe tools.",
                "confidence": 1.0,
            }

        return state

    def classify_intent(self, state: ChessAssistantState) -> ChessAssistantState:
        requested_mode = state.get("requested_mode", "followup")
        message = state.get("user_message", "").lower()

        intent = requested_mode
        if requested_mode == "followup":
            if "hint" in message:
                intent = "hint"
            elif any(
                cue in message
                for cue in (
                    "candidate move",
                    "forcing move",
                    "first forcing move",
                    "overloaded",
                    "full line",
                    "full answer",
                )
            ):
                intent = "hint"
            elif "theme" in message or "tactic" in message:
                intent = "theme"
            elif "mate" in message or "why" in message or "explain" in message:
                intent = "explain"

        return {
            **state,
            "intent": intent,
        }

    def load_puzzle_context(self, state: ChessAssistantState) -> ChessAssistantState:
        if state.get("guardrail_triggered"):
            return state

        hydrated_state = self._hydrate_context_from_history(state)
        mode = state.get("requested_mode", "followup")
        requires_position = mode in {"hint", "explain", "theme"}

        if not requires_position:
            return hydrated_state

        if not hydrated_state.get("fen"):
            return self._helpful_missing_context(
                hydrated_state,
                reason="missing_fen",
                message="Load a puzzle first. I need the position (FEN).",
            )

        if not hydrated_state.get("solver_move_san") and not hydrated_state.get(
            "solver_line"
        ):
            return self._helpful_missing_context(
                hydrated_state,
                reason="missing_solver_output",
                message="Solve the puzzle first. Then I can explain the best move and line.",
            )

        return hydrated_state

    def _hydrate_context_from_history(
        self, state: ChessAssistantState
    ) -> ChessAssistantState:
        # If the client did not provide live puzzle context, reuse the latest
        # stored solved puzzle for this local account when available.
        if state.get("fen") and (
            state.get("solver_move_san") or state.get("solver_line")
        ):
            return state

        history = state.get("user_puzzle_history", [])
        if not isinstance(history, list):
            return state

        for item in history:
            if not isinstance(item, dict):
                continue
            fen = item.get("fen")
            if not isinstance(fen, str) or not fen.strip():
                continue

            solution_lines_raw = item.get("solutionLines")
            solution_lines: list[str] = []
            if isinstance(solution_lines_raw, list):
                solution_lines = [
                    move.strip()
                    for move in solution_lines_raw
                    if isinstance(move, str) and move.strip()
                ]

            solver_move_san = solution_lines[0] if solution_lines else None
            return {
                **state,
                "fen": state.get("fen") or fen.strip(),
                "solver_move_san": state.get("solver_move_san") or solver_move_san,
                "solver_line": state.get("solver_line") or solution_lines,
            }

        return state

    def validate_position(self, state: ChessAssistantState) -> ChessAssistantState:
        if self._has_response(state):
            return state

        fen = state.get("fen")
        if not fen:
            return state

        fen_result = self._run_tool("validate_fen", fen=fen)
        if not fen_result["valid"]:
            return self._helpful_missing_context(
                state,
                reason="invalid_fen",
                message="This position is invalid. Reload the puzzle and try again.",
            )

        return {
            **state,
            "board_valid": True,
        }

    def analyze_position(self, state: ChessAssistantState) -> ChessAssistantState:
        if self._has_response(state):
            return state

        if not state.get("fen") or not state.get("board_valid"):
            return state

        fen = state["fen"]
        legal_moves = self._run_tool("list_legal_moves", fen=fen)
        next_state: ChessAssistantState = {
            **state,
            "legal_moves": legal_moves,
        }

        solver_solution = self._run_tool(
            "get_solver_solution",
            solver_move_san=state.get("solver_move_san"),
            solver_line=state.get("solver_line", []),
        )
        solver_move = solver_solution["solver_move_san"]
        solver_line = solver_solution["solver_line"]

        if solver_move:
            move_ok = self._run_tool("validate_move", fen=fen, move_san=solver_move)
            if not move_ok["valid"]:
                return self._helpful_missing_context(
                    next_state,
                    reason="illegal_solver_move",
                    message="The stored best move is illegal in this position. Re-run the solve.",
                )
            next_state["referenced_move"] = solver_move

        if solver_line:
            verification = self._run_tool(
                "verify_checkmate", fen=fen, solver_line=solver_line
            )
            if not verification["line_valid"]:
                return self._helpful_missing_context(
                    next_state,
                    reason="illegal_solver_line",
                    message="The stored line has illegal moves. Re-run the solve.",
                )
            next_state["checkmate_verified"] = verification["checkmate_verified"]
            if not next_state.get("referenced_move"):
                next_state["referenced_move"] = solver_line[0]

        return next_state

    def generate_hint(self, state: ChessAssistantState) -> ChessAssistantState:
        if self._has_response(state):
            return state

        move = state.get("referenced_move") or state.get("solver_move_san")
        if not move:
            return self._helpful_missing_context(
                state,
                reason="missing_move_for_hint",
                message="Solve the puzzle first. Then I can give a real hint.",
            )

        hint_level = self._resolve_hint_level(
            state.get("user_message", ""),
            explicit_stage=state.get("coaching_stage"),
        )
        emotional_context = state.get("emotional_context")
        slow_pace = (
            isinstance(emotional_context, dict)
            and emotional_context.get("pace") == "slow"
        )
        hint_text = self._hint_writer.invoke(
            {
                "coaching_stage": hint_level,
                "move": move,
                "line": state.get("solver_line", []),
                "checkmate_verified": state.get("checkmate_verified", False),
                "user_message": state.get("user_message", ""),
                "slow_pace": slow_pace,
                "conversation_mode": state.get("conversation_mode", "coach"),
            }
        )
        confidence = 0.93 if hint_level >= 5 else 0.86

        return {
            **state,
            "response_text": hint_text,
            "confidence": confidence,
            "referenced_move": move,
        }

    def explain_solution(self, state: ChessAssistantState) -> ChessAssistantState:
        if self._has_response(state):
            return state

        move = state.get("referenced_move") or state.get("solver_move_san")
        if not move:
            return self._helpful_missing_context(
                state,
                reason="missing_move_for_explanation",
                message="Solve the puzzle first. Then I can explain the verified move.",
            )

        explanation = self._explain_writer.invoke(
            {
                "move": move,
                "line": state.get("solver_line", []),
                "checkmate_verified": state.get("checkmate_verified", False),
                "conversation_mode": state.get("conversation_mode", "coach"),
            }
        )

        confidence = 0.94 if state.get("checkmate_verified") else 0.68
        return {
            **state,
            "response_text": explanation,
            "confidence": confidence,
            "referenced_move": move,
        }

    def identify_theme(self, state: ChessAssistantState) -> ChessAssistantState:
        if self._has_response(state):
            return state

        if not state.get("fen"):
            return self._helpful_missing_context(
                state,
                reason="missing_fen_for_theme",
                message="Load a puzzle first. I need a position to tag the theme.",
            )

        themes = self._run_tool(
            "classify_theme",
            fen=state["fen"],
            solver_move_san=state.get("solver_move_san"),
            solver_line=state.get("solver_line", []),
        )

        if themes:
            text = f"Likely themes: {', '.join(themes)}."
            confidence = 0.74
        else:
            text = "Theme is unclear from this line alone."
            confidence = 0.45

        return {
            **state,
            "theme_tags": themes,
            "response_text": text,
            "confidence": confidence,
        }

    def answer_followup(self, state: ChessAssistantState) -> ChessAssistantState:
        if self._has_response(state):
            return state

        message = state.get("user_message", "")
        lowered_message = message.lower()
        fen = state.get("fen")
        asks_history = any(
            keyword in lowered_message
            for keyword in (
                "history",
                "recent puzzles",
                "recent puzzle",
                "last puzzle",
                "last puzzles",
                "accuracy trend",
                "rating trend",
                "my solves",
            )
        )
        asks_profile = any(
            keyword in lowered_message
            for keyword in (
                "my profile",
                "my account",
                "my username",
                "my email",
                "who am i",
            )
        )
        if asks_history:
            history = self._run_tool(
                "retrieve_user_puzzle_history",
                history=state.get("user_puzzle_history", []),
                limit=10,
            )
            if history:
                summary = self._build_history_summary(history)
                return {
                    **state,
                    "response_text": summary,
                    "confidence": 0.84,
                }
            return {
                **state,
                "response_text": "No saved puzzle history yet for this account. Solve a few and check again.",
                "confidence": 0.9,
            }
        if asks_profile:
            return {
                **state,
                "response_text": self._build_profile_summary(state),
                "confidence": 0.9,
            }

        referenced_token = _first_move_token(message)
        if referenced_token and fen and state.get("board_valid"):
            move_validation = self._run_tool(
                "validate_move", fen=fen, move_san=referenced_token
            )
            if not move_validation["valid"]:
                return {
                    **state,
                    "response_text": (
                        f"{referenced_token} is illegal here. That line does not work."
                    ),
                    "referenced_move": referenced_token,
                    "confidence": 0.98,
                }

            return {
                **state,
                "response_text": (
                    f"{referenced_token} is legal here. Want a hint or the full line? "
                    "What is the first forcing move you see after it?"
                ),
                "referenced_move": referenced_token,
                "confidence": 0.82,
            }

        followup_text = self._followup_writer.invoke(
            {
                "message": message,
                "has_position": bool(state.get("fen")),
                "conversation_mode": state.get("conversation_mode", "coach"),
            }
        )
        return {
            **state,
            "response_text": followup_text,
            "confidence": 0.62,
        }

    def _build_history_summary(self, history: list[dict[str, Any]]) -> str:
        total = len(history)
        solved = 0
        first_move_correct = 0
        first_move_total = 0
        ratings: list[int] = []
        latest = history[0]

        for item in history:
            mate_in = item.get("mateIn")
            if isinstance(mate_in, int):
                solved += 1
            rating = item.get("difficultyRating") or item.get("puzzleElo")
            if isinstance(rating, int):
                ratings.append(rating)
            first_move = item.get("firstMoveCorrect")
            if isinstance(first_move, bool):
                first_move_total += 1
                if first_move:
                    first_move_correct += 1

        avg_rating = round(sum(ratings) / len(ratings)) if ratings else None
        first_move_accuracy = (
            round((first_move_correct / first_move_total) * 100, 1)
            if first_move_total > 0
            else None
        )
        latest_name = str(latest.get("fileName", "recent puzzle"))
        latest_rating = latest.get("difficultyRating") or latest.get("puzzleElo")

        parts = [
            f"You have {total} stored puzzles.",
            f"Latest: {latest_name} (rating {latest_rating}).",
            f"Solved mates logged: {solved}.",
        ]
        if avg_rating is not None:
            parts.append(f"Average rating: {avg_rating}.")
        if first_move_accuracy is not None:
            parts.append(f"First-move accuracy: {first_move_accuracy}%.")
        return " ".join(parts)

    def _build_profile_summary(self, state: ChessAssistantState) -> str:
        profile = state.get("user_profile_context")
        if not isinstance(profile, dict):
            return "I do not have profile details in this context."

        local_profile = profile.get("local_profile")
        auth_profile = profile.get("auth_profile")

        summary_parts: list[str] = []
        if isinstance(local_profile, dict):
            username = local_profile.get("username")
            email = local_profile.get("email")
            created_at = local_profile.get("created_at")
            if isinstance(username, str) and username.strip():
                summary_parts.append(f"Username: {username.strip()}.")
            if isinstance(email, str) and email.strip():
                summary_parts.append(f"Email: {email.strip()}.")
            if isinstance(created_at, str) and created_at.strip():
                summary_parts.append(f"Account created: {created_at.strip()}.")

        if isinstance(auth_profile, dict):
            display_name = auth_profile.get("name") or auth_profile.get("nickname")
            if isinstance(display_name, str) and display_name.strip():
                summary_parts.append(f"Display name: {display_name.strip()}.")

        history = state.get("user_puzzle_history", [])
        if isinstance(history, list):
            summary_parts.append(f"Stored puzzle records: {len(history)}.")

        if not summary_parts:
            return "I only have limited non-private profile data right now."
        return " ".join(summary_parts)

    def validate_response(self, state: ChessAssistantState) -> ChessAssistantState:
        response_text = state.get("response_text", "").strip()
        if not response_text:
            response_text = "Share a solved puzzle and I can break it down."

        for pattern in SECRET_PATTERNS:
            if pattern.search(response_text):
                response_text = "I can help with chess, but I cannot share secrets or internal data."
                state["guardrail_triggered"] = True
                state["guardrail_reason"] = "secret_redaction"
                break

        response_text = response_text.replace("system prompt", "internal prompt")
        response_text = response_text.replace("developer prompt", "internal rules")

        themes = [
            theme for theme in state.get("theme_tags", []) if theme in APPROVED_THEMES
        ]

        referenced_move = state.get("referenced_move")
        if referenced_move and state.get("fen"):
            move_valid = self._run_tool(
                "validate_move", fen=state["fen"], move_san=referenced_move
            )
            solver_move = state.get("solver_move_san")
            if not move_valid["valid"] and referenced_move != solver_move:
                referenced_move = solver_move

        claims_checkmate = (
            "checkmate" in response_text.lower() or "mate" in response_text.lower()
        )
        if (
            claims_checkmate
            and not state.get("checkmate_verified")
            and state.get("requested_mode")
            in {
                "explain",
                "hint",
            }
        ):
            response_text = "I can confirm the best move, but mate is not verified from this line yet."

        confidence = state.get("confidence", 0.0)
        if not isinstance(confidence, (float, int)):
            confidence = 0.0
        confidence = max(0.0, min(1.0, float(confidence)))

        emotional_context = state.get("emotional_context")
        coaching_memory = state.get("coaching_memory")
        conversation_mode = normalize_conversation_mode(
            cast(str | None, state.get("conversation_mode"))
        )
        if (
            not state.get("guardrail_triggered")
            and isinstance(emotional_context, dict)
            and state.get("requested_mode") in {"hint", "explain", "theme", "followup"}
            and conversation_mode not in {"grandmaster", "minimal"}
        ):
            cue = emotional_context.get("cue")
            memory_reference = build_memory_reference(
                coaching_memory if isinstance(coaching_memory, dict) else None
            )
            fragments: list[str] = []
            if isinstance(cue, str) and cue.strip():
                fragments.append(cue.strip())
            fragments.append(response_text)
            if isinstance(memory_reference, str) and memory_reference.strip():
                fragments.append(memory_reference.strip())
            response_text = " ".join(fragment for fragment in fragments if fragment)

        response_text = apply_personality(
            response_text,
            max_sentences=4,
            conversation_mode=conversation_mode,
        )

        return {
            **state,
            "response_text": response_text,
            "theme_tags": themes,
            "referenced_move": referenced_move,
            "confidence": confidence,
            "conversation_mode": conversation_mode,
        }

    def _route_after_guardrail(self, state: ChessAssistantState) -> str:
        return "blocked" if state.get("guardrail_triggered") else "continue"

    def _route_mode(self, state: ChessAssistantState) -> str:
        if self._has_response(state):
            return "end"
        mode = state.get("requested_mode", "followup")
        if mode in ALLOWED_MODES:
            return mode
        return "followup"

    def _resolve_hint_level(
        self, message: str, explicit_stage: int | None = None
    ) -> int:
        if isinstance(explicit_stage, int):
            return max(1, min(5, explicit_stage))
        lowered = message.lower()
        if self._wants_full_line(lowered):
            return 5
        if "hint 4" in lowered or "fourth hint" in lowered:
            return 4
        if "hint 3" in lowered or "third hint" in lowered:
            return 3
        if "hint 2" in lowered or "second hint" in lowered:
            return 2
        return 1

    def _wants_full_line(self, lowered_message: str) -> bool:
        return any(phrase in lowered_message for phrase in FULL_LINE_REQUEST_PHRASES)

    def _build_guiding_question(
        self,
        stage: int,
        conversation_mode: AssistantConversationMode,
    ) -> str:
        if stage <= 1:
            if conversation_mode == "minimal":
                return "Candidate move?"
            if conversation_mode == "rival":
                return "What was your first candidate?"
            return "What candidate move were you considering?"
        if stage == 2:
            if conversation_mode == "minimal":
                return "First forcing move?"
            if conversation_mode == "rival":
                return "Find the forcing move now."
            return "What is the first forcing move you see?"
        if stage == 3:
            if conversation_mode == "minimal":
                return "Which piece is overloaded?"
            return "Which piece feels overloaded here?"
        if conversation_mode == "rival":
            return "Need the line, or can you calculate it?"
        if conversation_mode == "grandmaster":
            return "Hint or full line?"
        return "Want a hint or the full line?"

    def _build_hint_text(self, payload: dict[str, Any]) -> str:
        stage = int(payload.get("coaching_stage", 1))
        move = str(payload.get("move", "the best move"))
        line = [
            token.strip()
            for token in payload.get("line", [])
            if isinstance(token, str) and token.strip()
        ]
        checkmate_verified = bool(payload.get("checkmate_verified", False))
        slow_pace = bool(payload.get("slow_pace", False))
        conversation_mode = normalize_conversation_mode(
            cast(str | None, payload.get("conversation_mode"))
        )
        acknowledgment = "Interesting position."
        if conversation_mode == "rival":
            acknowledgment = "Sharp position."
        elif conversation_mode == "grandmaster":
            acknowledgment = "Critical position."
        elif conversation_mode == "club_friend":
            acknowledgment = "Yeah, this one is sneaky."
        elif conversation_mode == "minimal":
            acknowledgment = ""

        guiding_question = self._build_guiding_question(stage, conversation_mode)
        directional_hint = "Now look at forcing checks that cut off escape squares."
        tactical_hint = (
            "Notice the overloaded defender and dark-square weakness around the king."
        )
        if conversation_mode == "rival":
            directional_hint = (
                "You saw the attack late. Force checks and cut escape squares."
            )
            tactical_hint = "Overloaded defender. Punish it immediately."
        elif conversation_mode == "grandmaster":
            directional_hint = "Only forcing line works. Start with checks."
            tactical_hint = "Track overloaded defense and dark-square control."
        elif conversation_mode == "club_friend":
            directional_hint = (
                "Start with forcing checks and see how the king runs out of squares."
            )
            tactical_hint = (
                "Also watch the overloaded defender; that is the tactical trigger."
            )
        elif conversation_mode == "minimal":
            directional_hint = "Checks first."
            tactical_hint = "Overloaded defender."

        if stage <= 1:
            if slow_pace:
                return (
                    f"{acknowledgment} Slow down for one clean scan. {guiding_question}"
                )
            return f"{acknowledgment} {guiding_question}"
        if stage == 2:
            return f"{acknowledgment} {guiding_question} {directional_hint}"
        if stage in {3, 4}:
            return f"{acknowledgment} {guiding_question} {directional_hint} {tactical_hint}"

        if line:
            mate_suffix = " Mate is verified." if checkmate_verified else ""
            if conversation_mode == "minimal":
                return f"{move}. {' '.join(line)}.{mate_suffix}".strip()
            return (
                f"{acknowledgment} Now calculate {move}. "
                f"Full line: {' '.join(line)}.{mate_suffix}"
            )

        return f"{acknowledgment} The key move is {move}. Want the full line next?"

    def _build_explanation_text(self, payload: dict[str, Any]) -> str:
        move = str(payload.get("move", ""))
        line = payload.get("line") or []
        checkmate_verified = bool(payload.get("checkmate_verified", False))
        conversation_mode = normalize_conversation_mode(
            cast(str | None, payload.get("conversation_mode"))
        )
        prefix = ""
        if conversation_mode == "coach":
            prefix = "You're close. "
        elif conversation_mode == "rival":
            prefix = "You saw the attack late. "
        elif conversation_mode == "club_friend":
            prefix = "Yeah this one is sneaky. "

        if checkmate_verified and line:
            return (
                f"{prefix}Best move: {move}. Line: {' '.join(line)}. "
                "Checkmate: no legal escape."
            )

        if line:
            return (
                f"{prefix}Best move: {move}. Line: {' '.join(line)}. "
                "Idea is clear, mate still unverified."
            )

        return f"{prefix}Best move: {move}. Send a full line and I will break it down."

    def _build_followup_text(self, payload: dict[str, Any]) -> str:
        message = str(payload.get("message", "")).lower()
        conversation_mode = normalize_conversation_mode(
            cast(str | None, payload.get("conversation_mode"))
        )
        for keyword, help_text in APP_FEATURE_HELP.items():
            if keyword in message:
                if conversation_mode == "minimal":
                    return help_text
                if conversation_mode == "rival":
                    return f"Quick read: {help_text}"
                if conversation_mode == "club_friend":
                    return f"Yep, {help_text}"
                return help_text

        has_position = bool(payload.get("has_position", False))
        if has_position:
            if conversation_mode == "minimal":
                return "Position loaded. Candidate move?"
            if conversation_mode == "grandmaster":
                return "Position loaded. Give your candidate move."
            return (
                "Position loaded. Want a hint or the full line? "
                "What candidate move were you considering?"
            )

        if conversation_mode == "minimal":
            return "Load puzzle. Then send candidate move."
        return (
            "I can help with app flow and training. "
            "For chess coaching, load a puzzle and tell me the first forcing move you see."
        )

    def _extract_requested_tool(self, message: str) -> str | None:
        lowered = message.lower()
        for pattern in [
            r"\buse tool\s+([a-z_][a-z0-9_]*)",
            r"\bcall tool\s+([a-z_][a-z0-9_]*)",
            r"\brun tool\s+([a-z_][a-z0-9_]*)",
        ]:
            match = re.search(pattern, lowered)
            if match:
                return match.group(1)
        return None

    def _helpful_missing_context(
        self,
        state: ChessAssistantState,
        *,
        reason: str,
        message: str,
    ) -> ChessAssistantState:
        return {
            **state,
            "response_text": message,
            "confidence": 1.0,
            "guardrail_reason": reason,
        }

    def _has_response(self, state: ChessAssistantState) -> bool:
        return bool(state.get("response_text"))

    def _run_tool(self, tool_name: str, **kwargs: Any) -> Any:
        if tool_name not in ALLOWED_TOOLS:
            raise ToolAccessError(tool_name=tool_name)
        handler = self._tool_handlers.get(tool_name)
        if handler is None:
            raise ToolAccessError(tool_name=tool_name)
        return handler(kwargs)

    def _tool_validate_fen(self, payload: dict[str, Any]) -> dict[str, Any]:
        fen = payload["fen"]
        try:
            board = chess.Board(fen)
        except Exception:
            return {"valid": False, "board": None}
        return {"valid": board.is_valid(), "board": board}

    def _tool_list_legal_moves(self, payload: dict[str, Any]) -> list[str]:
        board = chess.Board(payload["fen"])
        return [board.san(move) for move in board.legal_moves]

    def _tool_validate_move(self, payload: dict[str, Any]) -> dict[str, bool]:
        board = chess.Board(payload["fen"])
        move_san = payload["move_san"]
        try:
            board.parse_san(move_san)
            return {"valid": True}
        except Exception:
            return {"valid": False}

    def _tool_get_solver_solution(self, payload: dict[str, Any]) -> dict[str, Any]:
        solver_move_san = payload.get("solver_move_san")
        solver_line = [
            m for m in payload.get("solver_line", []) if isinstance(m, str) and m
        ]
        return {
            "solver_move_san": (
                solver_move_san
                if isinstance(solver_move_san, str) and solver_move_san
                else None
            ),
            "solver_line": solver_line,
        }

    def _tool_verify_checkmate(self, payload: dict[str, Any]) -> dict[str, bool]:
        board = chess.Board(payload["fen"])
        solver_line = payload.get("solver_line", [])
        for san in solver_line:
            try:
                move = board.parse_san(san)
            except Exception:
                return {"line_valid": False, "checkmate_verified": False}
            board.push(move)
        return {
            "line_valid": True,
            "checkmate_verified": board.is_checkmate(),
        }

    def _tool_classify_theme(self, payload: dict[str, Any]) -> list[str]:
        return self._classify_theme_from_position(
            fen=payload["fen"],
            solver_move_san=payload.get("solver_move_san"),
            solver_line=payload.get("solver_line", []),
        )

    def _tool_retrieve_user_puzzle_history(self, payload: dict[str, Any]) -> list[Any]:
        history = payload.get("history")
        if not isinstance(history, list):
            return []
        limit = payload.get("limit", 10)
        try:
            normalized_limit = max(1, min(int(limit), 100))
        except Exception:
            normalized_limit = 10
        return [item for item in history if isinstance(item, dict)][:normalized_limit]

    def _classify_theme_from_position(
        self,
        *,
        fen: str,
        solver_move_san: str | None,
        solver_line: list[str],
    ) -> list[str]:
        themes: list[str] = []
        text_blob = " ".join([solver_move_san or "", *solver_line]).lower()

        if "#" in text_blob:
            themes.append("mating net")

        board = chess.Board(fen)
        if solver_move_san:
            try:
                move = board.parse_san(solver_move_san)
                if board.is_capture(move):
                    themes.append("sacrifice")
                if board.gives_check(move):
                    themes.append("deflection")
                piece = board.piece_at(move.from_square)
                if piece and piece.piece_type == chess.KNIGHT:
                    themes.append("fork")
                if move.to_square in {chess.H7, chess.H2, chess.E8, chess.E1}:
                    themes.append("back-rank mate")
            except Exception:
                pass

        unique = []
        for theme in themes:
            if theme in APPROVED_THEMES and theme not in unique:
                unique.append(theme)

        if not unique and solver_line:
            unique.append("mating net")

        return unique


assistant_agent = ChessAssistantAgent()
