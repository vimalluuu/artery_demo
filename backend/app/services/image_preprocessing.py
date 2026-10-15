
from pathlib import Path

import cv2
import numpy as np


SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".tif", ".tiff"}
MAX_IMAGE_DIMENSION = 8192


class ImagePreprocessingError(ValueError):
    """Raised when an image cannot be safely preprocessed."""


def load_image(image_path: str | Path) -> np.ndarray:
    """Load a supported image without modifying the original file."""
    path = Path(image_path)

    if not path.is_file():
        raise ImagePreprocessingError("Image file does not exist")

    if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise ImagePreprocessingError("Unsupported image extension")

    image = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)

    if image is None:
        raise ImagePreprocessingError("Unable to decode image")

    if image.ndim not in (2, 3):
        raise ImagePreprocessingError("Unsupported image dimensions")

    height, width = image.shape[:2]

    if height < 1 or width < 1:
        raise ImagePreprocessingError("Image dimensions are invalid")

    if height > MAX_IMAGE_DIMENSION or width > MAX_IMAGE_DIMENSION:
        raise ImagePreprocessingError(
            f"Image dimensions must not exceed {MAX_IMAGE_DIMENSION} pixels per side"
        )

    if image.ndim == 3 and image.shape[2] not in (1, 3, 4):
        raise ImagePreprocessingError("Unsupported number of image channels")

    return image


def normalize_image(image: np.ndarray) -> np.ndarray:
    """Convert an image to float32 with pixel values in the range [0, 1]."""
    if image.size == 0:
        raise ImagePreprocessingError("Image is empty")

    if image.dtype == np.uint8:
        normalized = image.astype(np.float32) / 255.0
    elif image.dtype == np.uint16:
        normalized = image.astype(np.float32) / 65535.0
    elif np.issubdtype(image.dtype, np.floating):
        if not np.isfinite(image).all():
            raise ImagePreprocessingError(
                "Image contains non-finite pixel values"
            )

        if image.min() < 0.0 or image.max() > 1.0:
            raise ImagePreprocessingError(
                "Floating-point image values must be in the range [0, 1]"
            )

        normalized = image.astype(np.float32)
    else:
        raise ImagePreprocessingError(
            f"Unsupported pixel data type: {image.dtype}"
        )

    return normalized


def preprocess_image(
    image_path: str | Path,
    target_size: tuple[int, int] | None = None,
    grayscale: bool = False,
) -> np.ndarray:
    """
    Load and normalize an image for downstream model processing.

    target_size is specified as (width, height).
    Resizing is optional because model input dimensions depend on the
    selected segmentation architecture.
    """
    image = load_image(image_path)

    if grayscale and image.ndim == 3:
        if image.shape[2] == 1:
            image = image[:, :, 0]
        elif image.shape[2] == 3:
            image = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        else:
            image = cv2.cvtColor(image, cv2.COLOR_BGRA2GRAY)

    if target_size is not None:
        target_width, target_height = target_size

        if target_width < 1 or target_height < 1:
            raise ImagePreprocessingError(
                "Target width and height must be positive"
            )

        if (
            target_width > MAX_IMAGE_DIMENSION
            or target_height > MAX_IMAGE_DIMENSION
        ):
            raise ImagePreprocessingError("Target dimensions are too large")

        image = cv2.resize(
            image,
            (target_width, target_height),
            interpolation=cv2.INTER_AREA,
        )

    return normalize_image(image)
