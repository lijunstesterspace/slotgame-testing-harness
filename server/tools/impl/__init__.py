from server.tools.impl.testdata_parser_tool import TestdataParserTool
from server.tools.impl.testdata_generator_tool import TestdataGeneratorTool
from server.tools.impl.zip_packager_tool import ZipPackagerTool
from server.tools.impl.testdata_verifier_tool import TestdataVerifierTool
from server.tools.impl.log_diagnoser_tool import LogDiagnoserTool

BUILTIN_TOOLS: list = [
    TestdataParserTool(),
    TestdataGeneratorTool(),
    ZipPackagerTool(),
    TestdataVerifierTool(),
    LogDiagnoserTool(),
]
__all__ = ["BUILTIN_TOOLS",
           "TestdataParserTool", "TestdataGeneratorTool", "ZipPackagerTool",
           "TestdataVerifierTool", "LogDiagnoserTool"]
