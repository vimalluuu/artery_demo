"""Worker integration protocols. No production provider or worker is registered."""
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from sqlalchemy.orm import Session

from app.schemas.stenosis import AnalysisResult, SourceReference


class StenosisProvider(Protocol):
    method_id: str
    method_version: str
    checkpoint_sha256: str | None

    def execute(self, analysis_id: UUID, source: SourceReference) -> AnalysisResult:
        """Future worker-only operation; never called from an HTTP handler."""
        ...


class DurableDispatcher(Protocol):
    def accepting_jobs(self) -> bool:
        """A real consumer's readiness, not simulated progress or an enqueue thread."""
        ...


class ExplanationProvider(Protocol):
    """Future reviewed generator/target verifier. No implementation is registered."""
    method_id: str
    method_version: str
    model_id: str
    model_version: str
    checkpoint_sha256: str | None

    def verify_target(self, target, result: AnalysisResult, lesion_id: UUID | None) -> bool:
        """Verify a genuine prediction record/digest, not merely an attribution file.

        Must resolve target identity against the exact model output. Never return
        True based solely on user-supplied text or a matching filename.
        """
        ...

    def generate(self, result: AnalysisResult, target):
        """Future worker-only operation; no HTTP handler generates explanations."""
        ...


class PersistedResultStore(Protocol):
    def load(self, db: Session, result_id: UUID) -> AnalysisResult | None:
        """Load a durable result in this transaction, never an in-memory prediction.

        A later implementation must also prevent deletion/change of referenced
        results. Phase 3 supplies SQLResultStore, without registering a provider.
        """
        ...


@dataclass(frozen=True)
class ExecutionRuntime:
    provider: StenosisProvider
    dispatcher: DurableDispatcher
    results: PersistedResultStore
    explanations: tuple[ExplanationProvider, ...] = ()

    def ready(self) -> bool:
        try:
            return (self.provider is not None and callable(self.provider.execute)
                    and self.results is not None and callable(self.results.load)
                    and self.dispatcher.accepting_jobs() is True)
        except Exception:
            return False


def get_runtime() -> ExecutionRuntime | None:
    # Future reviewed composition point. No env toggle, test fake, thread or
    # FastAPI background task can accidentally activate execution here.
    return None
