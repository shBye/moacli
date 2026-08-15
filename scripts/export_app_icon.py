from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
WINDOWS_SOURCE = ROOT / "build" / "moacli-taskbar-alpha.png"
RENDERER_SOURCE = ROOT / "build" / "moacli-taskbar-alpha.png"
MASTER = ROOT / "build" / "icon.png"
WINDOWS_ICON = ROOT / "build" / "icon.ico"
RENDERER_ICON = ROOT / "src" / "assets" / "moacli-icon.png"


def resized(image: Image.Image, size: int) -> Image.Image:
    return image.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    with Image.open(WINDOWS_SOURCE) as source:
        image = source.convert("RGBA")
        master = resized(image, 1024)
        master.save(MASTER, optimize=True)
        master.save(
            WINDOWS_ICON,
            format="ICO",
            sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
        )
    with Image.open(RENDERER_SOURCE) as source:
        resized(source.convert("RGBA"), 128).save(RENDERER_ICON, optimize=True)


if __name__ == "__main__":
    main()
