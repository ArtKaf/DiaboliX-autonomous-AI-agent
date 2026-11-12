'use strict';

function patchText(original,target,replacement){
 if(typeof target!=='string'||!target||typeof replacement!=='string')throw Error('Укажите непустой исходный блок и строку замены.');
 if(target===replacement)throw Error('Патч ничего не меняет: target_content и replacement_content совпадают. Прочитай файл и укажи фактическое изменение.');
 const first=original.indexOf(target);
 if(first<0){
  const needle=target.split(/\r?\n/).map(line=>line.trim()).filter(line=>line.length>=8).slice(0,100);
  const lines=original.split('\n');let best=-1,bestScore=0;
  for(let i=0;i<lines.length&&i<30000;i++){const line=lines[i].trim();if(line.length<8)continue;let score=0;for(const candidate of needle){if(line===candidate)score=Math.max(score,2);else if(line.length>=16&&candidate.length>=16&&(line.includes(candidate)||candidate.includes(line)))score=Math.max(score,1)}if(score>bestScore){best=i;bestScore=score;if(score===2)break}}
  const hint=best<0?'':' Похожая строка '+(best+1)+': '+lines[best].slice(0,250).replace(/\r$/,'');
  throw Error('Блок не найден точно. Перечитай актуальный диапазон через read_file и проверь отступы и переносы строк; не применяй приблизительное совпадение автоматически.'+hint);
 }
 const second=original.indexOf(target,first+1);if(second>=0){const line=x=>original.slice(0,x).split('\n').length;throw Error(`Блок найден более одного раза (строки ${line(first)} и ${line(second)}). Добавь окружающие строки, чтобы совпадение было уникальным.`)}
 return original.slice(0,first)+replacement+original.slice(first+target.length);
}
module.exports={patchText};
