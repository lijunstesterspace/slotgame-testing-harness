import JSZip from 'jszip';
import { TestRecord } from '../types';

export const generateOutcomeZip = async (records: TestRecord[], loginName: string = ''): Promise<void> => {
  const zip = new JSZip();

  // Root or target folder
  const testdataFolder = zip.folder('testdata_suite') || zip;
  const moduleID = records[0]?.moduleID || '105359';

  // Group records by fileName
  const fileGroups: Record<string, TestRecord[]> = {};

  records.forEach((rec) => {
    const fileName = rec.fileName || (rec.formatType === 'DOUBLE_PREGEN' ? 'P5P_Bonus_Feature.testdata' : 'P5P_Base_Spins.testdata');
    if (!fileGroups[fileName]) {
      fileGroups[fileName] = [];
    }
    fileGroups[fileName].push(rec);
  });

  // Create each distinct .testdata file
  Object.entries(fileGroups).forEach(([fileName, groupRecords]) => {
    let xmlContent = `<?xml version="1.0" encoding="UTF-8"?>\n<Test>\n  <Key moduleID="${moduleID}" loginName="${loginName}" />\n  <Slot>\n`;

    groupRecords.forEach((rec) => {
      xmlContent += `    <!-- Case: ${rec.caseName} -->\n`;
      if (rec.formatType === 'DOUBLE_PREGEN') {
        xmlContent += `    <Spin stage="BaseGame">\n`;
        xmlContent += `      <PreGen batch="${rec.baseBatch}" index="${rec.baseIndex}"></PreGen>\n`;
        xmlContent += `      <Feature stage="Bonus">\n`;
        xmlContent += `        <PreGen batch="${rec.bonusBatch}" index="${rec.bonusIndex}"></PreGen>\n`;
        xmlContent += `      </Feature>\n`;
        xmlContent += `    </Spin>\n`;
      } else {
        xmlContent += `    <Spin stage="${rec.stage || 'BaseGame'}" comment="${rec.comment || rec.caseName}">\n`;
        xmlContent += `      <PreGen batch="${rec.baseBatch}" index="${rec.baseIndex}" />\n`;
        xmlContent += `    </Spin>\n`;
      }
    });

    xmlContent += `  </Slot>\n</Test>\n`;
    testdataFolder.file(fileName, xmlContent);
  });

  // Generate manifest file
  const manifestContent = JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      agentEngine: 'Slot-TestData-Generator-Agent-v2',
      totalFiles: Object.keys(fileGroups).length,
      totalRecords: records.length,
      moduleID,
      loginName,
      fileList: Object.keys(fileGroups)
    },
    null,
    2
  );
  testdataFolder.file('manifest.json', manifestContent);

  // Trigger download
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `outcome_testdata_module_${moduleID}_${loginName}.zip`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
