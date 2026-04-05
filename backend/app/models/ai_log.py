"""
AIDecisionLog — records every AI inference with confidence, input/output,
and human review status. Required for regulated AI in pharmacy settings.
"""
import enum
from sqlalchemy import Column, Integer, String, Enum, ForeignKey, DateTime, Boolean, Float, JSON, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class AIFeature(str, enum.Enum):
    FORECAST = "FORECAST"
    ANOMALY = "ANOMALY"
    CHAT = "CHAT"
    RECOMMENDATION = "RECOMMENDATION"


class ConfidenceLevel(str, enum.Enum):
    HIGH = "HIGH"       # confidence >= 0.8
    MEDIUM = "MEDIUM"   # confidence 0.5-0.8
    LOW = "LOW"         # confidence < 0.5


class AIDecisionLog(Base):
    __tablename__ = "ai_decision_logs"

    id = Column(Integer, primary_key=True, index=True)

    # Who triggered this
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=True)

    # What was asked
    feature = Column(Enum(AIFeature), nullable=False, index=True)
    input_summary = Column(Text, nullable=True)         # brief description of input
    input_payload = Column(JSON, nullable=True)         # full request payload

    # What was returned
    output_summary = Column(Text, nullable=True)        # brief human-readable summary
    output_payload = Column(JSON, nullable=True)        # full response payload

    # Confidence and review
    confidence_score = Column(Float, nullable=True)     # 0.0 – 1.0
    confidence_level = Column(Enum(ConfidenceLevel), nullable=True)
    requires_human_review = Column(Boolean, default=False, nullable=False)
    human_reviewed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    human_approved = Column(Boolean, nullable=True)    # None = not reviewed, True/False = decision
    review_notes = Column(Text, nullable=True)

    # Metadata
    model_version = Column(String(50), default="rule_based_v1", nullable=True)
    latency_ms = Column(Integer, nullable=True)         # inference time in ms
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User", foreign_keys=[user_id])
    reviewer = relationship("User", foreign_keys=[human_reviewed_by])
