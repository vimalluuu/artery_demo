from sqlalchemy.orm import Session

from app.models.audit import AuditEvent


def record_event(db: Session, action: str, actor_id: int | None = None,
                 resource_id: int | None = None) -> None:
    """Only controlled event names and numeric IDs; never credentials, tokens or PHI.

    The caller commits the event together with its business operation.
    """
    db.add(AuditEvent(action=action, actor_id=actor_id, resource_id=resource_id))
