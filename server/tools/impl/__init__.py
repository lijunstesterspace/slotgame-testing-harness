from server.tools.impl.paytable_parser_tool import PaytableParserTool
from server.tools.impl.testdata_generator_tool import TestdataGeneratorTool
from server.tools.impl.zip_packager_tool import ZipPackagerTool
from server.tools.impl.game_verifier_tool import GameVerifierTool
from server.tools.impl.log_diagnoser_tool import LogDiagnoserTool

BUILTIN_TOOLS: list = [
    PaytableParserTool(),
    TestdataGeneratorTool(),
    ZipPackagerTool(),
    GameVerifierTool(),
    LogDiagnoserTool(),
]
__all__ = ["BUILTIN_TOOLS",
           "PaytableParserTool", "TestdataGeneratorTool", "ZipPackagerTool",
           "GameVerifierTool", "LogDiagnoserTool"]
