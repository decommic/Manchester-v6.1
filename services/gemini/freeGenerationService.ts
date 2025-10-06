/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { 
    processApiError, 
    padImageToAspectRatio, 
    getAspectRatioPromptInstruction, 
    parseDataUrl, 
    callGeminiWithRetry, 
    processGeminiResponse 
} from './baseService';

/**
 * Creates a blank, white canvas as a data URL.
 * @param width The width of the canvas.
 * @param height The height of the canvas.
 * @returns A data URL string of a white PNG image.
 */
const createBlankCanvasDataUrl = (width: number, height: number): string => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, width, height);
    }
    return canvas.toDataURL('image/png');
};

export async function generateFreeImage(
    prompt: string,
    aspectRatio: string,
    imageDataUrl1?: string,
    imageDataUrl2?: string,
    removeWatermark?: boolean
): Promise<string[]> {
    try {
        // If no image is provided, create a blank one to initiate a text-to-image like flow.
        const baseImageUrl = imageDataUrl1 || createBlankCanvasDataUrl(1024, 1024);
        
        const parts: object[] = [];
        let inputImageCount = 0;

        const image1ToProcess = await padImageToAspectRatio(baseImageUrl, aspectRatio);
        const { mimeType, data } = parseDataUrl(image1ToProcess);
        parts.push({ inlineData: { mimeType, data } });
        inputImageCount++;
        
        if (imageDataUrl2) {
            const image2ToProcess = await padImageToAspectRatio(imageDataUrl2, aspectRatio);
            const { mimeType: mime2, data: data2 } = parseDataUrl(image2ToProcess);
            parts.push({ inlineData: { mimeType: mime2, data: data2 } });
            inputImageCount++;
        }

        const promptParts = [
            ...getAspectRatioPromptInstruction(aspectRatio, inputImageCount),
            prompt,
        ];
        
        if (imageDataUrl1) {
             promptParts.push('Thực hiện yêu cầu trong prompt để tạo ra một bức ảnh mới dựa trên (các) hình ảnh đã cho.');
        } else {
             promptParts.push('Sử dụng prompt để vẽ lên khung ảnh trắng này, tạo ra một hình ảnh hoàn toàn mới.');
        }

        if (removeWatermark) {
            promptParts.push('Yêu cầu đặc biệt: Không được có bất kỳ watermark, logo, hay chữ ký nào trên ảnh kết quả.');
        }

        const fullPrompt = promptParts.join('\n');
        parts.push({ text: fullPrompt });

        console.log("Attempting unified image generation...");
        const response = await callGeminiWithRetry(parts);
        const resultUrl = await processGeminiResponse(response);
        return [resultUrl];

    } catch (error) {
        const processedError = processApiError(error);
        console.error("Error during free image generation:", processedError);
        throw processedError;
    }
}