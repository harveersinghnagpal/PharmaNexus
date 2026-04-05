"""
Async in-process event bus for domain event decoupling.
Simulates microservices event-driven communication without external message brokers.
Each domain publishes events; audit and notification subscribers listen.
"""
import asyncio
from typing import Callable, Dict, List, Any
from dataclasses import dataclass, field
from datetime import datetime
from loguru import logger


@dataclass
class DomainEvent:
    """Base class for all domain events."""
    event_type: str
    payload: Dict[str, Any]
    timestamp: datetime = field(default_factory=datetime.utcnow)
    source_service: str = "unknown"
    request_id: str = ""


class EventBus:
    """
    Lightweight async in-process event bus.
    Handlers are called with the DomainEvent and a DB session must be managed by the publisher.
    """

    def __init__(self):
        self._handlers: Dict[str, List[Callable]] = {}

    def subscribe(self, event_type: str, handler: Callable):
        """Register a handler for a specific event type."""
        if event_type not in self._handlers:
            self._handlers[event_type] = []
        self._handlers[event_type].append(handler)
        logger.debug(f"EventBus: {handler.__name__} subscribed to '{event_type}'")

    async def publish(self, event: DomainEvent):
        """Publish an event to all registered handlers (fire-and-forget pattern)."""
        handlers = self._handlers.get(event.event_type, [])
        if not handlers:
            logger.debug(f"EventBus: No handlers for '{event.event_type}'")
            return
        for handler in handlers:
            try:
                if asyncio.iscoroutinefunction(handler):
                    await handler(event)
                else:
                    handler(event)
            except Exception as e:
                # Event bus must NEVER crash the publisher
                logger.error(f"EventBus: Handler '{handler.__name__}' failed for '{event.event_type}': {e}")


# Singleton event bus instance
bus = EventBus()

# ─── Event Type Constants ───────────────────────────────────────────────────
SALE_CREATED = "sale.created"
BATCH_ADDED = "inventory.batch_added"
TRANSFER_CREATED = "inventory.transfer_created"
STOCK_UPDATED = "inventory.stock_updated"
PRESCRIPTION_CREATED = "prescription.created"
PRESCRIPTION_APPROVED = "prescription.approved"
PRESCRIPTION_DISPENSED = "prescription.dispensed"
AI_DECISION_MADE = "ai.decision_made"
USER_LOGIN = "auth.user_login"
