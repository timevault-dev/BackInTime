"""Read-only API routes backed by core services."""

import logging
import platform
import shutil

from fastapi import APIRouter, HTTPException, Query

from backintime import __version__
from backintime.api.dependencies import ConfigStoreDependency
from backintime.api.schemas import (
    HealthResponse,
    ProfileListResponse,
    ProfileResponse,
    SnapshotDirectoryResponse,
    SnapshotEntryResponse,
    SystemInfoResponse,
)
from backintime.core.exceptions import (
    ConfigurationError,
    RepositoryError,
    SnapshotNotFoundError,
    ValidationError,
)
from backintime.core.repository import Repository
from backintime.core.snapshot_id import SnapshotID

router = APIRouter(prefix="/api/v1")
_logger = logging.getLogger("backintime.api")


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Report that the API process is responsive without inspecting user config."""
    return HealthResponse(status="ok", version=__version__)


@router.get("/system/info", response_model=SystemInfoResponse)
def system_info() -> SystemInfoResponse:
    """Report runtime capabilities without exposing filesystem locations."""
    return SystemInfoResponse(
        platform=platform.system(),
        python_version=platform.python_version(),
        rsync_available=shutil.which("rsync") is not None,
    )


@router.get(
    "/profiles/{profile_id}/snapshots/{snapshot_id}/files",
    response_model=SnapshotDirectoryResponse,
)
def browse_snapshot_files(
    profile_id: str,
    snapshot_id: str,
    config_store: ConfigStoreDependency,
    path: str = Query(default=""),
    limit: int = Query(default=100, ge=1, le=100),
    after: str | None = Query(default=None),
) -> SnapshotDirectoryResponse:
    """Browse one safe, bounded page in a healthy profile snapshot."""
    try:
        configuration = config_store.load()
    except ConfigurationError as exc:
        _logger.error("Configuration read failed: %s", exc)
        raise HTTPException(
            status_code=503,
            detail={
                "code": "CONFIGURATION_INVALID",
                "message": "The application configuration could not be loaded or validated.",
            },
        ) from exc

    profile = next(
        (item for item in configuration.profiles if item.profile_id == profile_id),
        None,
    )
    if profile is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "PROFILE_NOT_FOUND", "message": "The selected profile does not exist."},
        )

    try:
        validated_snapshot_id = SnapshotID.parse(snapshot_id)
    except ValidationError as exc:
        raise HTTPException(
            status_code=400,
            detail={"code": "INVALID_SNAPSHOT_ID", "message": "The snapshot ID is invalid."},
        ) from exc

    try:
        listing = Repository(profile.target).browse_snapshot(
            validated_snapshot_id,
            path,
            limit=limit,
            after=after,
        )
    except SnapshotNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "SNAPSHOT_NOT_FOUND",
                "message": "The selected snapshot was not found.",
            },
        ) from exc
    except ValidationError as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "SNAPSHOT_PATH_NOT_ALLOWED",
                "message": "The requested path is invalid or outside the selected snapshot.",
            },
        ) from exc
    except RepositoryError as exc:
        _logger.error("Snapshot browsing failed: %s", exc)
        raise HTTPException(
            status_code=503,
            detail={
                "code": "SNAPSHOT_REPOSITORY_UNAVAILABLE",
                "message": "The selected snapshot repository could not be read.",
            },
        ) from exc

    return SnapshotDirectoryResponse(
        snapshot_id=str(validated_snapshot_id),
        path=listing.path,
        entries=[
            SnapshotEntryResponse(
                name=entry.name,
                kind=entry.kind,
                size_bytes=entry.size_bytes,
                modified_time_ns=entry.modified_time_ns,
            )
            for entry in listing.entries
        ],
        next_cursor=listing.next_cursor,
    )


@router.get("/profiles", response_model=ProfileListResponse)
def list_profiles(config_store: ConfigStoreDependency) -> ProfileListResponse:
    """List validated configured profiles using the existing core ConfigStore."""
    try:
        configuration = config_store.load()
    except ConfigurationError as exc:
        raise HTTPException(
            status_code=503,
            detail={"code": "CONFIGURATION_INVALID", "message": str(exc)},
        ) from exc

    return ProfileListResponse(
        profiles=[
            ProfileResponse(
                profile_id=profile.profile_id,
                name=profile.name,
                sources=[str(path) for path in profile.sources],
                target=str(profile.target),
                excludes=list(profile.excludes),
            )
            for profile in configuration.profiles
        ]
    )


@router.get("/profiles/{profile_id}", response_model=ProfileResponse)
def get_profile(profile_id: str, config_store: ConfigStoreDependency) -> ProfileResponse:
    """Return one configured profile by its stable identifier."""
    try:
        configuration = config_store.load()
    except ConfigurationError as exc:
        raise HTTPException(
            status_code=503,
            detail={"code": "CONFIGURATION_INVALID", "message": str(exc)},
        ) from exc

    for profile in configuration.profiles:
        if profile.profile_id == profile_id:
            return ProfileResponse(
                profile_id=profile.profile_id,
                name=profile.name,
                sources=[str(path) for path in profile.sources],
                target=str(profile.target),
                excludes=list(profile.excludes),
            )
    raise HTTPException(
        status_code=404,
        detail={"code": "PROFILE_NOT_FOUND", "message": "The selected profile does not exist."},
    )
