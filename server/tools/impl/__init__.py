from server.tools.impl.testdata_parser_tool import TestdataParserTool
from server.tools.impl.testdata_generator_tool import TestdataGeneratorTool
from server.tools.impl.zip_packager_tool import ZipPackagerTool
from server.tools.impl.testdata_verifier_tool import TestdataVerifierTool
from server.tools.impl.testdata_verifier_api_tool import TestdataVerifierApiTool
from server.tools.impl.testdata_verifier_harness_tool import TestdataVerifierHarnessTool
from server.tools.impl.log_diagnoser_tool import LogDiagnoserTool
from server.tools.impl.html_to_text_converter_tool import HtmlToTextConverterTool
from server.tools.impl.diff_comparator_tool import DiffComparatorTool
from server.tools.impl.helpfile_analyzer_tool import HelpfileAnalyzerTool

BUILTIN_TOOLS: list = [
    TestdataParserTool(),
    TestdataGeneratorTool(),
    ZipPackagerTool(),
    TestdataVerifierTool(),
    TestdataVerifierApiTool(),
    TestdataVerifierHarnessTool(),
    LogDiagnoserTool(),
    HtmlToTextConverterTool(),
    DiffComparatorTool(),
    HelpfileAnalyzerTool(),
]
__all__ = [
    "BUILTIN_TOOLS",
    "TestdataParserTool", "TestdataGeneratorTool", "ZipPackagerTool",
    "TestdataVerifierTool", "TestdataVerifierApiTool", "TestdataVerifierHarnessTool",
    "LogDiagnoserTool", "HtmlToTextConverterTool", "DiffComparatorTool", "HelpfileAnalyzerTool",
]
