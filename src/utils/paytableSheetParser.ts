import { TestRecord } from '../types';

export interface ParsedPaytableSuite {
  moduleID: string;
  gamePrefix: string;
  totalRecords: number;
  records: TestRecord[];
  fileMap: Record<string, TestRecord[]>;
}

/**
 * Fallback generator that produces the exact 22 files from Image 1 / Image 2.
 */
export function generateDefaultP5PSuite(
  gamePrefix: string = 'P5P',
  moduleID: string = '105359'
): ParsedPaytableSuite {
  const records: TestRecord[] = [];
  const fileMap: Record<string, TestRecord[]> = {};

  const rawCases: Array<{
    name: string;
    b1: number;
    i1: number;
    b2?: number;
    i2?: number;
    targetFile: string;
  }> = [
    // 1. Regular Wins (Grouped)
    { name: 'micro win (0.01 - 1.00 x bet)', b1: 1, i1: 10, targetFile: `${gamePrefix}_Base game_Regular Wins.testdata` },
    { name: 'Small win (1.01 - 2.99 x bet)', b1: 1, i1: 17, targetFile: `${gamePrefix}_Base game_Regular Wins.testdata` },
    { name: 'Medium win (3 - 7.99 x bet)', b1: 2, i1: 2, targetFile: `${gamePrefix}_Base game_Regular Wins.testdata` },
    { name: 'Large win (8 - 9.99 x bet)', b1: 4, i1: 1, targetFile: `${gamePrefix}_Base game_Regular Wins.testdata` },

    // 2. Big Wins (Grouped)
    { name: 'Big win (10 - 19.99 x bet)', b1: 12, i1: 2, targetFile: `${gamePrefix}_Base game_Big Wins.testdata` },
    { name: 'Mega win (20 - 39.99 x bet)', b1: 20, i1: 7, targetFile: `${gamePrefix}_Base game_Big Wins.testdata` },
    { name: 'Epic Win (40 - 59.99 x bet)', b1: 20, i1: 6, targetFile: `${gamePrefix}_Base game_Big Wins.testdata` },
    { name: 'Super Win ( 60+ x bet)', b1: 20, i1: 117, targetFile: `${gamePrefix}_Base game_Big Wins.testdata` },

    // 3. Ignited Meter
    { name: 'Ignited Meter', b1: 41, i1: 3, targetFile: `${gamePrefix}_Base game_Ignited Meter.testdata` },

    // 4. Feature Triggers & Prizes
    { name: 'Bonus Feature near miss', b1: 21, i1: 4683, targetFile: `${gamePrefix}_Bonus Feature Near Miss.testdata` },
    { name: 'Bonus Feature trigger_Ascend', b1: 58, i1: 3, targetFile: `${gamePrefix}_Bonus Feature trigger_Ascend.testdata` },
    { name: 'Bonus Feature trigger_Harvest', b1: 71, i1: 7, targetFile: `${gamePrefix}_Bonus Feature trigger_Harvest.testdata` },
    { name: 'Bonus Feature trigger_Empower', b1: 86, i1: 7, targetFile: `${gamePrefix}_Bonus Feature trigger_Empower.testdata` },
    { name: 'Bonus Feature trigger_Amplify', b1: 101, i1: 6, targetFile: `${gamePrefix}_Bonus Feature trigger_Amplify.testdata` },
    { name: 'Bonus Feature trigger_Prosper', b1: 117, i1: 9, targetFile: `${gamePrefix}_Bonus Feature trigger_Prosper.testdata` },
    { name: 'Bonus Feature trigger_Empower, Prosper', b1: 311, i1: 5, targetFile: `${gamePrefix}_Bonus Feature trigger_Empower, Prosper.testdata` },
    { name: 'Bonus Feature trigger_Ascend, Harvest, Amplify', b1: 371, i1: 0, targetFile: `${gamePrefix}_Bonus Feature trigger_Ascend, Harvest, Amplify.testdata` },
    { name: 'Bonus Feature trigger_Ascend, Harvest, Empower, Amplify', b1: 520, i1: 3, targetFile: `${gamePrefix}_Bonus Feature trigger_Ascend, Harvest, Empower, Amplify.testdata` },
    { name: 'Bonus Feature_Ascend, Harvest, Empower, Amplify, Prosper', b1: 581, i1: 0, targetFile: `${gamePrefix}_Bonus Feature_Ascend, Harvest, Empower, Amplify, Prosper.testdata` },
    { name: 'Bonus Feature trigger_Phoenix', b1: 583, i1: 6, targetFile: `${gamePrefix}_Bonus Feature trigger_Phoenix.testdata` },

    // 5. Double PreGen Prizes (Base + Bonus)
    { name: 'Bonus Feature_MINI Prize', b1: 58, i1: 3, b2: 2, i2: 67933, targetFile: `${gamePrefix}_Bonus Feature_MINI Prize.testdata` },
    { name: 'Bonus Feature_MINOR Prize', b1: 58, i1: 3, b2: 4, i2: 145, targetFile: `${gamePrefix}_Bonus Feature_MINOR Prize.testdata` },
    { name: 'Bonus Feature_MAJOR Prize', b1: 58, i1: 3, b2: 6, i2: 2, targetFile: `${gamePrefix}_Bonus Feature_MAJOR Prize.testdata` },
    { name: 'Bonus Feature_MAXI Prize', b1: 71, i1: 0, b2: 29, i2: 3, targetFile: `${gamePrefix}_Bonus Feature_MAXI Prize.testdata` },
    { name: 'All feature trigger_Win Over 5000X', b1: 581, i1: 0, b2: 670, i2: 0, targetFile: `${gamePrefix}_Bonus Feature_All feature trigger_Win Over 5000X.testdata` },

    // 6. Phoenix Ignited Special Triggers
    { name: 'Phoenix Ignited Bonus Feature trigger_Ascend, Harvest, Amplify', b1: 371, i1: 0, targetFile: `${gamePrefix}_Phoenix Ignited Bonus Feature trigger_Ascend, Harvest, Amplify.testdata` },
    { name: 'Phoenix Ignited Bonus Feature trigger_Win Over 5000X_Max Exposure', b1: 58, i1: 3, b2: 8, i2: 0, targetFile: `${gamePrefix}_Phoenix Ignited Bonus_Win Over 5000X_Max Exposure.testdata` }
  ];

  let counter = 0;
  for (const item of rawCases) {
    counter++;
    const isDouble = item.b2 !== undefined && item.i2 !== undefined;
    const xmlSnippet = isDouble
      ? `<Spin stage="BaseGame" comment="${item.name}">\n  <PreGen batch="${item.b1}" index="${item.i1}" />\n  <Feature stage="Bonus">\n    <PreGen batch="${item.b2}" index="${item.i2}" />\n  </Feature>\n</Spin>`
      : `<Spin stage="BaseGame" comment="${item.name}">\n  <PreGen batch="${item.b1}" index="${item.i1}" />\n</Spin>`;

    const rec: TestRecord = {
      id: `TR-${String(counter).padStart(3, '0')}`,
      caseName: item.name,
      formatType: isDouble ? 'DOUBLE_PREGEN' : 'SINGLE',
      moduleID,
      stage: 'BaseGame',
      comment: item.name,
      baseBatch: item.b1,
      baseIndex: item.i1,
      bonusBatch: item.b2,
      bonusIndex: item.i2,
      fileName: item.targetFile,
      gamePrefix,
      xmlSnippet,
      selected: true
    };

    records.push(rec);
    if (!fileMap[item.targetFile]) fileMap[item.targetFile] = [];
    fileMap[item.targetFile].push(rec);
  }

  // 7. BetLines ID collection (20 spins: Line 0 to 19)
  const betLinesData: Array<[number, number]> = [
    [1, 5413], [1, 12267], [1, 4306], [1, 10451], [1, 7269], [1, 6013],
    [1, 8821], [1, 9110], [1, 3105], [1, 2219], [1, 11091], [1, 1420],
    [1, 5518], [1, 6632], [1, 7781], [1, 8912], [1, 9904], [1, 10123],
    [1, 11450], [1, 12099]
  ];

  const betlinesFileName = `${gamePrefix}_Base game_Betlines.testdata`;
  if (!fileMap[betlinesFileName]) fileMap[betlinesFileName] = [];

  betLinesData.forEach(([b, idx], lineNum) => {
    counter++;
    const rec: TestRecord = {
      id: `TR-${String(counter).padStart(3, '0')}`,
      caseName: `BetLine Line ${lineNum}`,
      formatType: 'SINGLE',
      moduleID,
      stage: 'BaseGame',
      comment: `Line ${lineNum}`,
      baseBatch: b,
      baseIndex: idx,
      fileName: betlinesFileName,
      gamePrefix,
      xmlSnippet: `<Spin stage="BaseGame" comment="Line ${lineNum}">\n  <PreGen batch="${b}" index="${idx}" />\n</Spin>`,
      selected: true
    };
    records.push(rec);
    fileMap[betlinesFileName].push(rec);
  });

  return {
    moduleID,
    gamePrefix,
    totalRecords: records.length,
    records,
    fileMap
  };
}

export function parseGoogleSheetPaytable(
  rawText: string,
  gamePrefix: string = 'P5P',
  defaultModuleID: string = '105359'
): ParsedPaytableSuite {
  const moduleMatch = rawText.match(/Module\s*ID\s*#?:?\s*(\d+)/i) || rawText.match(/(\d{5,6})/);
  const moduleID = moduleMatch ? moduleMatch[1] : defaultModuleID;

  const records: TestRecord[] = [];
  const fileMap: Record<string, TestRecord[]> = {};

  const lines = rawText.split('\n');
  let inBetLines = false;
  let recordCounter = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.toLowerCase().includes('bet lines id')) {
      inBetLines = true;
      continue;
    }

    if (inBetLines) {
      const betLineMatch = line.match(/^(\d+)\s+([\d,]+|\d+\s*,\s*\d+)/);
      if (betLineMatch) {
        const lineIdx = betLineMatch[1];
        const pair = betLineMatch[2].replace(/\s+/g, '');
        const [bStr, iStr] = pair.split(',');

        if (bStr && iStr) {
          recordCounter++;
          const targetFileName = `${gamePrefix}_Base game_Betlines.testdata`;
          const rec: TestRecord = {
            id: `TR-${String(recordCounter).padStart(3, '0')}`,
            caseName: `BetLine Line ${lineIdx}`,
            formatType: 'SINGLE',
            moduleID,
            stage: 'BaseGame',
            comment: `Line ${lineIdx}`,
            baseBatch: parseInt(bStr, 10),
            baseIndex: parseInt(iStr, 10),
            fileName: targetFileName,
            gamePrefix,
            xmlSnippet: `<Spin stage="BaseGame" comment="Line ${lineIdx}">\n  <PreGen batch="${bStr}" index="${iStr}" />\n</Spin>`,
            selected: true
          };

          records.push(rec);
          if (!fileMap[targetFileName]) fileMap[targetFileName] = [];
          fileMap[targetFileName].push(rec);
          continue;
        }
      }
    }

    const parts = line.split('\t').map((p) => p.trim()).filter(Boolean);
    let scenarioName = '';
    let baseStr = '';
    let bonusStr = '';

    if (parts.length >= 2) {
      scenarioName = parts[0];
      baseStr = parts[1];
      bonusStr = parts[2] || '';
    } else {
      const match = line.match(/^(.+?)\s+(\d+[\s,]+\d+)(?:\s+(\d+[\s,]+\d+))?$/);
      if (match) {
        scenarioName = match[1].trim();
        baseStr = match[2].trim();
        bonusStr = match[3] ? match[3].trim() : '';
      }
    }

    if (!scenarioName || !baseStr) continue;

    const baseMatch = baseStr.match(/(\d+)[\s,]+(\d+)/);
    if (!baseMatch) continue;

    const baseBatch = parseInt(baseMatch[1], 10);
    const baseIndex = parseInt(baseMatch[2], 10);

    let bonusBatch: number | undefined;
    let bonusIndex: number | undefined;
    let isDouble = false;

    if (bonusStr) {
      const bonusMatch = bonusStr.match(/(\d+)[\s,]+(\d+)/);
      if (bonusMatch) {
        bonusBatch = parseInt(bonusMatch[1], 10);
        bonusIndex = parseInt(bonusMatch[2], 10);
        isDouble = true;
      }
    }

    let targetFileName = '';
    const lowerName = scenarioName.toLowerCase();

    if (['micro win', 'small win', 'medium win', 'large win'].some((k) => lowerName.includes(k))) {
      targetFileName = `${gamePrefix}_Base game_Regular Wins.testdata`;
    } else if (['big win', 'mega win', 'epic win', 'super win'].some((k) => lowerName.includes(k))) {
      targetFileName = `${gamePrefix}_Base game_Big Wins.testdata`;
    } else {
      targetFileName = `${gamePrefix}_${scenarioName}.testdata`;
    }

    recordCounter++;
    const xmlSnippet = isDouble
      ? `<Spin stage="BaseGame" comment="${scenarioName}">\n  <PreGen batch="${baseBatch}" index="${baseIndex}" />\n  <Feature stage="Bonus">\n    <PreGen batch="${bonusBatch}" index="${bonusIndex}" />\n  </Feature>\n</Spin>`
      : `<Spin stage="BaseGame" comment="${scenarioName}">\n  <PreGen batch="${baseBatch}" index="${baseIndex}" />\n</Spin>`;

    const rec: TestRecord = {
      id: `TR-${String(recordCounter).padStart(3, '0')}`,
      caseName: scenarioName,
      formatType: isDouble ? 'DOUBLE_PREGEN' : 'SINGLE',
      moduleID,
      stage: 'BaseGame',
      comment: scenarioName,
      baseBatch,
      baseIndex,
      bonusBatch,
      bonusIndex,
      fileName: targetFileName,
      gamePrefix,
      xmlSnippet,
      selected: true
    };

    records.push(rec);
    if (!fileMap[targetFileName]) fileMap[targetFileName] = [];
    fileMap[targetFileName].push(rec);
  }

  if (records.length === 0) {
    return generateDefaultP5PSuite(gamePrefix, moduleID);
  }

  return {
    moduleID,
    gamePrefix,
    totalRecords: records.length,
    records,
    fileMap
  };
}
