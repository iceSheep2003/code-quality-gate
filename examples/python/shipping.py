def shipping_cost(total, express=False):
    """Orders of 100 or more ship free; express adds 5."""
    if total < 0:
        raise ValueError("total must not be negative")
    base = 0 if total >= 100 else 8
    return base + (5 if express else 0)
