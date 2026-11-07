"""Deterministic mock data: `python -m app.seed` (re)loads it."""

from app.seed.catalogue import DEMO_ACCOUNTS
from app.seed.dataset import Dataset, build_dataset

__all__ = ["DEMO_ACCOUNTS", "Dataset", "build_dataset"]
