import { SlotGameConfig, TestRecord } from '../types';
import { generateDefaultP5PSuite } from '../utils/paytableSheetParser';

export const MOCK_GAME_CONFIGS: SlotGameConfig[] = [
  {
    id: 'medusa-gold',
    name: "Medusa's Gold (P5P)",
    reels: '5x3 Reels',
    paylines: 20,
    moduleId: '105359',
    theme: 'Greek Mythology / High Volatility'
  }
];

export const INITIAL_TEST_RECORDS: TestRecord[] = generateDefaultP5PSuite('P5P', '105359').records;
