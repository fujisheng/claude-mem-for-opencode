/**
 * 隐私标签过滤工具
 * 用于移除 <private>...</private> 标签内的所有内容
 */

/**
 * 移除文本中 <private>...</private> 标签内的所有内容
 * @param text - 输入文本
 * @returns 过滤后的文本
 */
export function stripPrivateTags(text: string): string {
	return text.replace(/<private>[\s\S]*?<\/private>/gi, "");
}
