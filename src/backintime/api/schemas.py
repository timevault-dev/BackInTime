"""Validated API request and response models."""

from typing import Literal

from pydantic import BaseModel, ConfigDict


class HealthResponse(BaseModel):
    """Liveness response."""

    status: str
    version: str


class SystemInfoResponse(BaseModel):
    """Non-sensitive runtime capability information."""

    platform: str
    python_version: str
    rsync_available: bool


class ProfileResponse(BaseModel):
    """Read-only view of a configured backup profile."""

    model_config = ConfigDict(frozen=True)

    profile_id: str
    name: str
    sources: list[str]
    target: str
    excludes: list[str]


class ProfileListResponse(BaseModel):
    """Configured profiles."""

    profiles: list[ProfileResponse]


class SnapshotEntryResponse(BaseModel):
    """Safe metadata for one browsable snapshot entry."""

    name: str
    kind: Literal["directory", "file", "symlink", "other"]
    size_bytes: int
    modified_time_ns: int


class SnapshotDirectoryResponse(BaseModel):
    """One bounded page of entries from a snapshot directory."""

    snapshot_id: str
    path: str
    entries: list[SnapshotEntryResponse]
    next_cursor: str | None


class ErrorDetail(BaseModel):
    """Stable API error fields."""

    code: str
    message: str
    request_id: str


class ErrorResponse(BaseModel):
    """Consistent API error envelope."""

    error: ErrorDetail
