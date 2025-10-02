/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import ai from './client'; // Import the shared client instance
import { 
    processApiError, 
    padImageToAspectRatio, 
    getAspectRatioPromptInstruction, 
    parseDataUrl, 
    callGeminiWithRetry, 
    processGeminiResponse 
} from './baseService';

type ImagenAspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9';

function mapToImagenAspectRatio(ratio: string): ImagenAspectRatio {
    const ratioMap: { [key: string]: ImagenAspectRatio } = {
        '1:1': '1:1', '2:3': '3:4', '4:5': '3:4', '9:16': '9:16', '1:2': '9:16',
        '3:2': '4:3', '5:4': '4:3', '16:9': '16:9', '2:1': '16:9',
    };
    return ratioMap[ratio] || '1:1';
}

export async function generateFreeImage(
    prompt: string,
    numberOfImages: number,
    aspectRatio: string,
    imageDataUrl1?: string,
    imageDataUrl2?: string,
    removeWatermark?: boolean
): Promise<string[]> {
    try {
        // Case 1: Image generation (Text-to-Image)
        if (!imageDataUrl1) {
            const maxRetries = 3;
            const initialDelay = 1000;
            let lastError: Error | null = null;

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    console.log(`Attempting text-to-image generation (Attempt ${attempt}/${maxRetries})...`);
                    
                    const config: {
                        numberOfImages: number;
                        outputMimeType: 'image/jpeg';
                        aspectRatio?: ImagenAspectRatio;
                    } = {
                        numberOfImages: numberOfImages,
                        outputMimeType: 'image/jpeg',
                    };
                    if (aspectRatio && aspectRatio !== 'Giữ nguyên') {
                        config.aspectRatio = mapToImagenAspectRatio(aspectRatio);
                    }

                    const response = await ai.models.generateImages({
                        model: 'imagen-4.0-generate-001',
                        prompt: prompt,
                        config: config,
                    });

                    if (response.generatedImages && response.generatedImages.length > 0) {
                        return response.generatedImages.map(img => `data:image/jpeg;base64,${img.image.imageBytes}`);
                    } else {
                        // This counts as a soft failure to be retried
                        throw new Error("API did not return any images.");
                    }
                } catch (error) {
                    lastError = error instanceof Error ? error : new Error(JSON.stringify(error));
                    const rawErrorMessage = lastError.message.toLowerCase();
                    console.error(`Error calling generateImages API (Attempt ${attempt}/${maxRetries}):`, lastError.message);

                    // Non-retriable errors
                    if (rawErrorMessage.includes('api key not valid') || rawErrorMessage.includes('quota')) {
                        throw error;
                    }
                }

                // If we reach here, it's a retriable error.
                if (attempt < maxRetries) {
                    const delay = initialDelay * Math.pow(2, attempt - 1) + Math.random() * 1000; // Add jitter
                    console.log(`Waiting ${Math.round(delay)}ms before next attempt...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
             throw lastError || new Error("Image generation API call failed after all retries.");
        }

        // Case 2: Image editing (Image-to-Image / Image+Image-to-Image)
        // This mode only supports 1 image output.
        const parts: object[] = [];
        let inputImageCount = 0;

        if (imageDataUrl1) {
            const image1ToProcess = await padImageToAspectRatio(imageDataUrl1, aspectRatio);
            const { mimeType, data } = parseDataUrl(image1ToProcess);
            parts.push({ inlineData: { mimeType, data } });
            inputImageCount++;
        }
        if (imageDataUrl2) {
            const image2ToProcess = await padImageToAspectRatio(imageDataUrl2, aspectRatio);
            const { mimeType, data } = parseDataUrl(image2ToProcess);
            parts.push({ inlineData: { mimeType, data } });
            inputImageCount++;
        }

        const promptParts = [
            ...getAspectRatioPromptInstruction(aspectRatio, inputImageCount),
            prompt,
            'Thực hiện yêu cầu trong prompt để tạo ra một bức ảnh mới dựa trên (các) hình ảnh đã cho.'
        ];

        if (removeWatermark) {
            promptParts.push('Yêu cầu đặc biệt: Không được có bất kỳ watermark, logo, hay chữ ký nào trên ảnh kết quả.');
        }

        const fullPrompt = promptParts.join('\n');
        parts.push({ text: fullPrompt });

        console.log("Attempting image editing generation...");
        const response = await callGeminiWithRetry(parts);
        const resultUrl = await processGeminiResponse(response);
        return [resultUrl]; // Return as an array with one item
    } catch (error) {
        const processedError = processApiError(error);
        console.error("Error during free image generation:", processedError);
        throw processedError;
    }
}