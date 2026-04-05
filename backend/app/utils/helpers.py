from datetime import date, timedelta
import random


def generate_batch_number(prefix: str = "BT") -> str:
    import random, string
    suffix = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
    return f"{prefix}-{suffix}"


def future_date(days: int) -> date:
    return date.today() + timedelta(days=days)


def past_date(days: int) -> date:
    return date.today() - timedelta(days=days)
