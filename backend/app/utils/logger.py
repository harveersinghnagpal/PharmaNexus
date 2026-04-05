import sys
from loguru import logger


def setup_logger():
    logger.remove()
    logger.add(
        sys.stdout,
        format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{line}</cyan> — <level>{message}</level>",
        level="INFO",
    )
    logger.add(
        "logs/pharmanexus.log",
        rotation="10 MB",
        retention="7 days",
        level="DEBUG",
    )
    return logger
