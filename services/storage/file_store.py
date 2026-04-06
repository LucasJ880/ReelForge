from pathlib import Path
import structlog
import uuid

logger = structlog.get_logger()


class FileStore:
    """本地文件存储，MVP 阶段使用，后续替换为 S3/MinIO"""

    def __init__(self, base_path: str = "./storage"):
        self.base_path = Path(base_path)
        self.base_path.mkdir(parents=True, exist_ok=True)

    def save(self, data: bytes, filename: str | None = None, subdir: str = "general") -> str:
        """保存文件，返回存储路径"""
        target_dir = self.base_path / subdir
        target_dir.mkdir(parents=True, exist_ok=True)

        if not filename:
            filename = f"{uuid.uuid4().hex}"

        filepath = target_dir / filename
        filepath.write_bytes(data)
        logger.info("file_store.save", path=str(filepath), size=len(data))
        return str(filepath)

    def load(self, filepath: str) -> bytes:
        """读取文件"""
        path = Path(filepath)
        if not path.exists():
            raise FileNotFoundError(f"File not found: {filepath}")
        return path.read_bytes()

    def get_url(self, filepath: str) -> str:
        """获取文件 URL（本地实现直接返回路径）"""
        return f"file://{filepath}"

    def delete(self, filepath: str) -> bool:
        """删除文件"""
        path = Path(filepath)
        if path.exists():
            path.unlink()
            return True
        return False

    def list_files(self, subdir: str = "") -> list[str]:
        """列出目录下的文件"""
        target = self.base_path / subdir if subdir else self.base_path
        if not target.exists():
            return []
        return [str(f) for f in target.iterdir() if f.is_file()]
