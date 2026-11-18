import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {test,expect} from 'vitest';
import {ExperimentOverview,legacyReport} from '../../apps/desktop/src/experiment-overview.tsx';
test('legacy presentation only classifies explicit labels and retains all original text',()=>{
 const text='历程：选择 Godot\n结果：完成原型\n没有证据的句子不能猜为成功\n可复用：网络基础\n待定：性能';
 expect(legacyReport(text)).toEqual({done:['选择 Godot','完成原型'],failed:[],reusable:['网络基础'],pending:['性能']});
 const html=renderToStaticMarkup(<ExperimentOverview record={{summary:text}}/>);expect(html).toContain('没有证据的句子不能猜为成功');expect(html).toContain('尚未记录');
});
test('structured report renders five categories and manual newlines become individual bullet points',()=>{
 const html=renderToStaticMarkup(<ExperimentOverview record={{report:{done:['完成验证'],failed:['多人重叠发言不稳定'],reusable:['转写流程'],pending:['需实际试用']},summary:'保留原文'}}/>);
 for(const label of ['做了什么','什么行不通','可复用经验','待定事项','其他','完成验证','保留原文'])expect(html).toContain(label);
 const multiline=renderToStaticMarkup(<ExperimentOverview record={{report:{done:['第一条\n• 第二条\r\n\n第三条'],failed:[],reusable:[],pending:[],other:['额外说明\n补充备注']}}}/>);
 expect(multiline.match(/<li>/g)).toHaveLength(5);for(const text of ['第一条','第二条','第三条','额外说明','补充备注'])expect(multiline).toContain(`<span>${text}</span>`);
});
