/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { 
    processApiError, 
    padImageToAspectRatio,
    parseDataUrl, 
    callGeminiWithRetry, 
    processGeminiResponse 
} from './baseService';

interface DressModelOptions {
    background: string;
    pose: string;
    style: string;
    aspectRatio: string;
    notes?: string;
    removeWatermark?: boolean;
    naturalEnhancementMode: 'off' | 'automatic' | 'custom';
    naturalEnhancementRefs: (string | null)[];
    faceRestore?: boolean;
    upscale: string;
    denoise: string;
    sharpen: string;
}

/**
 * Generates an image of a model wearing specified clothing with advanced options.
 * @param modelImageDataUrl Data URL for the model's image.
 * @param clothingImageDataUrl Data URL for the clothing's image.
 * @param options User-selected options for background, pose, quality, and notes.
 * @param referenceImageUrl Optional data URL for a style reference image.
 * @returns A promise that resolves to the generated image's data URL.
 */
export async function generateDressedModelImage(
    modelImageDataUrl: string, 
    clothingImageDataUrl: string, 
    options: DressModelOptions,
    referenceImageUrl?: string | null
): Promise<string> {
    const modelImageToProcess = await padImageToAspectRatio(modelImageDataUrl, options.aspectRatio ?? 'Giữ nguyên');
    const { mimeType: modelMime, data: modelData } = parseDataUrl(modelImageToProcess);
    const { mimeType: clothingMime, data: clothingData } = parseDataUrl(clothingImageDataUrl);

    const modelImagePart = { inlineData: { mimeType: modelMime, data: modelData } };
    const clothingImagePart = { inlineData: { mimeType: clothingMime, data: clothingData } };

    const parts: any[] = [clothingImagePart, modelImagePart];
    let imageCounter = 2;

    if (referenceImageUrl) {
        const { mimeType: refMime, data: refData } = parseDataUrl(referenceImageUrl);
        const refImagePart = { inlineData: { mimeType: refMime, data: refData } };
        parts.push(refImagePart);
        imageCounter++;
    }

    if (options.naturalEnhancementMode === 'custom') {
        options.naturalEnhancementRefs.forEach(url => {
            if (url) {
                const { mimeType, data } = parseDataUrl(url);
                parts.push({ inlineData: { mimeType, data } });
            }
        });
    }
    
    const promptParts = [];

    if (referenceImageUrl) {
        promptParts.push(
            '**PHÂN TÍCH ẢNH THAM CHIẾU (Ảnh 3):**',
            'Phân tích kỹ lưỡng Ảnh 3 để xác định phong cách nghệ thuật, đặc biệt là về ánh sáng, tông màu, và không khí chung. Nhiệm vụ của bạn là áp dụng CHÍNH XÁC phong cách này vào ảnh kết quả cuối cùng để đảm bảo tính nhất quán.',
            ''
        );
    }

    if (options.aspectRatio && options.aspectRatio !== 'Giữ nguyên') {
        promptParts.push(
            `**YÊU CẦU ƯU TIÊN SỐ 1 - TỶ LỆ KHUNG HÌNH:**`,
            `1. Bức ảnh kết quả BẮT BUỘC phải có tỷ lệ khung hình chính xác là **${options.aspectRatio}**.`,
            `2. **Quan trọng:** Ảnh 2 (người mẫu) có thể đã được thêm nền trắng để đạt đúng tỷ lệ này. Nhiệm vụ của bạn là lấp đầy phần nền trắng đó một cách sáng tạo, mở rộng bối cảnh theo các tùy chọn bên dưới. Điều này KHÔNG có nghĩa là thay đổi người mẫu, mà là xây dựng môi trường xung quanh họ.`,
            ''
        );
    }

    promptParts.push(
        '**Nhiệm vụ chính:**',
        'Tôi cung cấp cho bạn các tấm ảnh sau:',
        '- Ảnh 1: Một trang phục.',
        '- Ảnh 2: Một người mẫu.',
        referenceImageUrl ? '- Ảnh 3: Một ảnh tham chiếu phong cách.' : '',
        options.naturalEnhancementMode === 'custom' && options.naturalEnhancementRefs.some(u => u) ? `- Ảnh ${imageCounter + 1} trở đi: Các ảnh tham chiếu màu da/ánh sáng.` : '',
        'Nhiệm vụ của bạn là tạo ra một bức ảnh MỚI, trong đó người mẫu từ Ảnh 2 đang mặc trang phục từ Ảnh 1.',
        '',
        '**YÊU CẦU CỰC KỲ QUAN TRỌNG:**',
        '1.  **GIỮ NGUYÊN NGƯỜI MẪU:** Phải giữ lại chính xác 100% khuôn mặt, vóc dáng, màu da, kiểu tóc của người mẫu trong Ảnh 2. Tuyệt đối không được thay đổi người mẫu.',
        '2.  **CHUYỂN ĐỔI TRANG PHỤC:** Lấy trang phục từ Ảnh 1 và mặc nó lên người mẫu một cách tự nhiên và chân thực, phù hợp với tư thế của họ. Giữ nguyên màu sắc, họa tiết và kiểu dáng của trang phục.',
        '3.  **TÙY CHỈNH KẾT QUẢ:** Dựa vào các yêu cầu sau để tạo ra bức ảnh cuối cùng:'
    );
    
    let optionsSelected = false;
    if (options.background && options.background !== 'Tự động') {
        promptParts.push(`    *   **Bối cảnh (Background):** ${options.background}.`);
        optionsSelected = true;
    }
    if (options.pose && options.pose !== 'Tự động') {
        promptParts.push(`    *   **Tư thế (Pose):** ${options.pose}.`);
        optionsSelected = true;
    }
    if (options.style && options.style !== 'Tự động') {
        promptParts.push(`    *   **Phong cách ảnh (Photo Style):** ${options.style}.`);
        optionsSelected = true;
    }
    if (options.notes) {
        promptParts.push(`    *   **Ghi chú:** ${options.notes}`);
        optionsSelected = true;
    }
    
    if (!optionsSelected && !referenceImageUrl) {
        promptParts.push('    *   **Toàn quyền sáng tạo:** Hãy tự động chọn bối cảnh, tư thế và phong cách ảnh phù hợp nhất với trang phục và người mẫu để tạo ra một bức ảnh thời trang ấn tượng.');
    }
    
    promptParts.push(
        '',
        'Kết quả cuối cùng phải là một bức ảnh duy nhất, chất lượng cao, trông giống như ảnh chụp thời trang chuyên nghiệp. Chỉ trả về ảnh kết quả, không trả về ảnh gốc hay văn bản giải thích.'
    );

    if (options.removeWatermark) {
        promptParts.push('YÊU CẦU THÊM: Ảnh kết quả không được chứa bất kỳ watermark, logo hay chữ ký nào.');
    }

    if (options.naturalEnhancementMode === 'automatic') {
        promptParts.push(
            '',
            '**YÊU CẦU CẢI THIỆN TỰ NHIÊN (ƯU TIÊN RẤT CAO):**',
            'Phân tích kỹ lưỡng màu da, tông màu và đặc điểm ánh sáng trên người mẫu trong Ảnh 2. Áp dụng chính xác các đặc điểm này vào ảnh kết quả cuối cùng.',
            'Kết quả phải trông giống như một bức ảnh chụp thật, không phải tranh vẽ hay ảnh render 3D. Tránh các nét vẽ ảo và làm cho làn da trông tự nhiên, chân thực nhất có thể.'
        );
    } else if (options.naturalEnhancementMode === 'custom') {
        const validRefs = options.naturalEnhancementRefs.filter(url => url);
        if (validRefs.length > 0) {
            const refIndices = Array.from({ length: validRefs.length }, (_, i) => imageCounter + 1 + i).join(', ');
            promptParts.push(
                '',
                '**YÊU CẦU CẢI THIỆN TỰ NHIÊN (TÙY CHỈNH - ƯU TIÊN CAO NHẤT):**',
                `Phân tích kỹ lưỡng màu da, tông màu và đặc điểm ánh sáng từ các **Ảnh tham chiếu ${refIndices}**.`,
                'Áp dụng chính xác các đặc điểm này vào ảnh kết quả cuối cùng.',
                'Kết quả phải trông giống như một bức ảnh chụp thật, không phải tranh vẽ. Tránh các nét vẽ ảo và làm cho làn da trông tự nhiên, chân thực nhất có thể.'
            );
        }
    }


    const prompt = promptParts.filter(Boolean).join('\n');
    const textPart = { text: prompt };
    parts.push(textPart);

    try {
        console.log("Attempting to generate dressed model image with dynamic prompt...", prompt);
        const response = await callGeminiWithRetry(parts);
        return processGeminiResponse(response);
    } catch (error) {
        const processedError = processApiError(error);
        console.error("Error during dressed model image generation:", processedError);
        throw processedError;
    }
}