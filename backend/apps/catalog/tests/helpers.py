import io

from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image


def image_file(name="photo.png", fmt="PNG", size=(800, 600), color=(120, 60, 20), mode="RGB", exif=False):
    buf = io.BytesIO()
    img = Image.new(mode, size, color)
    kwargs = {}
    if exif and fmt == "JPEG":
        exif_data = Image.Exif()
        exif_data[0x010F] = "SecretCamera"  # Make
        kwargs["exif"] = exif_data
    img.save(buf, format=fmt, **kwargs)
    content_type = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp", "GIF": "image/gif"}.get(
        fmt, "application/octet-stream"
    )
    return SimpleUploadedFile(name, buf.getvalue(), content_type=content_type)
