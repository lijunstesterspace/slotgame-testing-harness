from __future__ import annotations
import json
import time
from abc import ABC, abstractmethod
from dataclasses import field
from typing import Any, Optional
from pydantic import BaseModel, Field, ConfigDict


class ToolParameter(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    type: str = "string"           # string / number / boolean / object / array
    description: str = ""
    required: bool = False
    default: Any = None
    enum: Optional[list[Any]] = None


class ToolInputSchema(BaseModel):
    properties: list[ToolParameter] = Field(default_factory=list)


class ToolInfo(BaseModel):
    name: str
    description: str
    inputSchema: ToolInputSchema = Field(default_factory=ToolInputSchema)
    permissions: list[str] = Field(default_factory=list)
    timeout_seconds: int = 60
    version: str = "1.0.0"


class ToolResult(BaseModel):
    success: bool
    content: Any = None
    error: Optional[str] = None
    execution_ms: int = 0
    artifacts: list[str] = Field(default_factory=list)


class HarnessContext(BaseModel):
    execution_id: str
    user_id: str
    user_role: str
    session_token: str
    work_dir: str


class ToolPlugin(ABC):
    @property
    @abstractmethod
    def info(self) -> ToolInfo: ...

    def validate(self, params: dict[str, Any]) -> tuple[bool, str, dict[str, Any]]:
        out: dict[str, Any] = {}
        expected = {p.name: p for p in self.info.inputSchema.properties}
        for p in self.info.inputSchema.properties:
            if p.required and p.name not in params and p.default is None:
                return False, f"missing_required_param:{p.name}", {}
        for k, v in (params or {}).items():
            if k not in expected:
                return False, f"unknown_param:{k}", {}
            spec = expected[k]
            if v is None:
                if spec.default is not None:
                    out[k] = spec.default
                elif spec.required:
                    return False, f"param_empty:{k}", {}
                continue
            # very light type coercion
            try:
                if spec.type == "number":
                    # 数字参数：已是 int/float（bool 除外）直接保留，否则按字面量强转
                    if not isinstance(v, bool) and isinstance(v, (int, float)):
                        pass
                    else:
                        v = int(v) if str(v).lstrip("-").isdigit() else float(v)
                elif spec.type == "boolean":
                    if isinstance(v, bool):
                        pass
                    else:
                        v = str(v).lower() in {"1", "true", "yes", "on"}
                out[k] = v
            except Exception:
                return False, f"param_type_mismatch:{k}:{spec.type}", {}
        for p in self.info.inputSchema.properties:
            if p.name not in out and p.default is not None:
                out[p.name] = p.default
        return True, "", out

    async def execute(self, params: dict[str, Any], context: HarnessContext) -> ToolResult:
        t0 = time.perf_counter()
        ok, err, validated = self.validate(params)
        if not ok:
            return ToolResult(success=False, error=err, execution_ms=int((time.perf_counter() - t0) * 1000))
        try:
            res = await self._run_impl(validated, context)
            res.execution_ms = int((time.perf_counter() - t0) * 1000)
            return res
        except Exception as e:
            return ToolResult(success=False, error=f"unexpected:{type(e).__name__}:{e}",
                              execution_ms=int((time.perf_counter() - t0) * 1000))

    @abstractmethod
    async def _run_impl(self, params: dict[str, Any], context: HarnessContext) -> ToolResult: ...


class ToolRegistry:
    def __init__(self):
        self._plugins: dict[str, ToolPlugin] = {}

    def register(self, plugin: ToolPlugin) -> None:
        self._plugins[plugin.info.name] = plugin

    def list_info(self) -> list[ToolInfo]:
        return [p.info for p in self._plugins.values()]

    def get(self, name: str) -> ToolPlugin:
        if name not in self._plugins:
            raise KeyError(f"tool_not_found:{name}")
        return self._plugins[name]

    def as_function_calling_schema(self) -> list[dict]:
        out = []
        for info in self.list_info():
            props = {}
            required: list[str] = []
            for p in info.inputSchema.properties:
                entry: dict[str, Any] = {"type": p.type, "description": p.description}
                if p.enum:
                    entry["enum"] = p.enum
                props[p.name] = entry
                if p.required:
                    required.append(p.name)
            out.append({
                "type": "function",
                "function": {
                    "name": info.name,
                    "description": info.description,
                    "parameters": {
                        "type": "object",
                        "properties": props,
                        "required": required,
                    }
                }
            })
        return out
