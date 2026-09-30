import assert from 'node:assert/strict';
export const textChanges=[
  ['画面下の「入力を終える」で保存用ファイルを出力し、ブックに戻って「保存して終了」を押してください。ブラウザ内には保存しません。',
   '画面下部の「アプリを終了して保存作業に移る」を押し、表示される案内に沿ってブックで保存してください。'],
  ['画面のデータを、このバックアップの内容に置き換えます。ブックへの確定保存は「入力を終える」の後に行います。',
   '画面のデータを、このバックアップの内容に置き換えます。保存して終わるときは、画面下部の「アプリを終了して保存作業に移る」を押し、表示される案内に沿って進めてください。']
];
export function verifyBusinessCopy(source,baseline){
  let restored=source.toString('utf8');
  for(const [before,after] of textChanges){
    assert.equal(restored.split(after).length,2,'Each permitted copy change must occur exactly once');
    restored=restored.replace(after,before);
  }
  assert.equal(restored,baseline.toString('utf8'),'Business HTML changed beyond the two permitted guidance strings');
  return {layoutAndCodePreserved:true,guidanceStringsUpdated:2};
}
