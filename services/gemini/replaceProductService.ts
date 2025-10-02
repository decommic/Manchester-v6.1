/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { 
    processApiError,
    parseDataUrl, 
    callGeminiWithRetry, 
    processGeminiResponse,
    padImageToAspectRatio,
    getAspectRatioPromptInstruction
} from './baseService';

interface ReplaceProductOptions {
    layout: string;
    sceneStyle: string;
    shootingStyle?: string;
    productDescription?: string;
    sceneDescription?: string;
    sceneAction: string;
    productScale: string;
    productShadow?: string;
    decoNotes?: string;
    aspectRatio?: string;
    lightingCategory?: string;
    naturalLight?: string;
    studioLight?: string;
    styleLight?: string;
    syncLighting?: boolean;
}

/**
 * Places a product from one image into a scene from another, with intelligent processing.
 * @param productImageUrl Data URL for the product image.
 * @param sceneImageUrl Data URL for the scene image.
 * @param options User-selected options for layout and style.
 * @param decoImageUrls Array of optional data URLs for decoration images.
 * @returns A promise that resolves to the generated image's data URL.
 */
export async function generateReplacedProductImage(
    productImageUrl: string, 
    sceneImageUrl: string, 
    options: ReplaceProductOptions,
    decoImageUrls: (string | null | undefined)[],
    referenceImageUrl?: string | null
): Promise<string> {
    const sceneImageToProcess = await padImageToAspectRatio(sceneImageUrl, options.aspectRatio ?? 'Giữ nguyên');
    
    const { mimeType: productMime, data: productData } = parseDataUrl(productImageUrl);
    const { mimeType: sceneMime, data: sceneData } = parseDataUrl(sceneImageToProcess);

    const productImagePart = { inlineData: { mimeType: productMime, data: productData } };
    const sceneImagePart = { inlineData: { mimeType: sceneMime, data: sceneData } };

    const parts: any[] = [productImagePart, sceneImagePart];
    let imageCounter = 2; // product=1, scene=2
    
    let decoImageCounter = 0;
    if (decoImageUrls && decoImageUrls.length > 0) {
        decoImageUrls.forEach(url => {
            if (url) {
                const { mimeType, data } = parseDataUrl(url);
                parts.push({ inlineData: { mimeType, data } });
                decoImageCounter++;
            }
        });
    }
    imageCounter += decoImageCounter;

    if (referenceImageUrl) {
        const { mimeType: refMime, data: refData } = parseDataUrl(referenceImageUrl);
        const refImagePart = { inlineData: { mimeType: refMime, data: refData } };
        parts.push(refImagePart);
        imageCounter++;
    }
    
    const promptParts: string[] = [];
    
    if (referenceImageUrl) {
        promptParts.push(
            `**PHÂN TÍCH ẢNH THAM CHIẾU (Ảnh ${imageCounter}):**`,
            'Phân tích kỹ lưỡng ảnh này để xác định phong cách nghệ thuật, đặc biệt là về ánh sáng, tông màu, và không khí chung. Nhiệm vụ của bạn là áp dụng CHÍNH XÁC phong cách này vào ảnh kết quả cuối cùng để đảm bảo tính nhất quán.',
            ''
        );
    }

    if (options.aspectRatio && options.aspectRatio !== 'Giữ nguyên' && options.aspectRatio !== 'Keep Original') {
        promptParts.push(...getAspectRatioPromptInstruction(options.aspectRatio, 1));
    }

    promptParts.push(
        'Bạn là một chuyên gia ghép ảnh sản phẩm AI. Nhiệm vụ của bạn là thực hiện một quy trình phức tạp để tạo ra một bức ảnh sản phẩm chuyên nghiệp.',
        '**QUY TRÌNH BẮT BUỘC:**'
    );
    
    const sceneActionInstruction = options.sceneAction === 'Giữ nguyên bối cảnh' || options.sceneAction === 'Keep Scene As-Is'
        ? 'GIỮ NGUYÊN bối cảnh gốc. TUYỆT ĐỐI KHÔNG xóa bất kỳ vật thể nào.'
        : 'Kiểm tra kỹ ảnh bối cảnh (Ảnh 2). Nếu ảnh này chứa một chủ thể nổi bật (ví dụ: một người mẫu, một sản phẩm thời trang khác như váy, áo, túi xách), hãy **XÓA** chủ thể đó đi một cách hoàn hảo. Sau khi xóa, hãy sử dụng kỹ thuật inpainting để tái tạo lại phần nền bị che một cách thông minh và liền mạch, đảm bảo không để lại dấu vết. Nếu bối cảnh vốn đã không có chủ thể nổi bật, hãy bỏ qua bước này.';
    
    let productAnalysisPrompt = '1. **PHÂN TÍCH ẢNH SẢN PHẨM (Ảnh 1):** Tự động nhận diện chủ thể sản phẩm chính. Tách nền sản phẩm một cách hoàn hảo, giữ lại mọi chi tiết, bóng đổ tự nhiên của sản phẩm nếu có.';
    if(options.productDescription) {
        productAnalysisPrompt += `\n   - **Mô tả bổ sung về sản phẩm:** ${options.productDescription}. Hãy đảm bảo các chi tiết này được thể hiện rõ trên sản phẩm cuối cùng.`
    }

    let sceneAnalysisPrompt = `2. **PHÂN TÍCH & XỬ LÝ BỐI CẢNH (Ảnh 2):** ${sceneActionInstruction}`;
    if(options.sceneDescription) {
        sceneAnalysisPrompt += `\n   - **Mô tả bổ sung về bối cảnh:** ${options.sceneDescription}. Hãy sử dụng mô tả này để tinh chỉnh hoặc tạo ra bối cảnh cuối cùng.`
    }

    promptParts.push(
        productAnalysisPrompt,
        sceneAnalysisPrompt,
        '3. **GHÉP ẢNH THÔNG MINH:** Đặt sản phẩm đã tách nền từ Bước 1 vào bối cảnh đã xử lý từ Bước 2. Việc ghép ảnh phải siêu thực, bao gồm việc điều chỉnh ánh sáng, màu sắc, và tạo bóng đổ phù hợp để sản phẩm hòa hợp hoàn toàn với môi trường.',
    );

    if (options.syncLighting) {
        promptParts.push(
            '   - **Đồng bộ ánh sáng (QUAN TRỌNG):** Phân tích kỹ lưỡng ánh sáng và bóng đổ trong bối cảnh (ví dụ: vệt nắng, bóng râm từ vật thể khác). Ánh sáng và bóng đổ này phải được áp dụng một cách chân thực lên sản phẩm, như thể sản phẩm là một phần của bối cảnh đó. Nếu có một vệt sáng đi qua vị trí đặt sản phẩm, vệt sáng đó cũng phải hiện diện trên sản phẩm.'
        );
    }
    
    if (decoImageCounter > 0) {
        promptParts.push(`4. **DECO SÁNG TẠO (Ảnh 3 đến Ảnh ${3 + decoImageCounter - 1}):** Phân tích (các) ảnh deco này. **YÊU CẦU QUAN TRỌNG:** Chỉ xác định và lấy các **chi tiết trang trí nhỏ lẻ** hoặc các **yếu tố phụ** (ví dụ: hoa, lá, vệt sáng, họa tiết nhỏ) từ (các) ảnh deco này. **TUYỆT ĐỐI KHÔNG** sử dụng toàn bộ ảnh deco làm bối cảnh mới. Sau đó, hãy thêm các chi tiết nhỏ đã trích xuất này vào bối cảnh chính một cách tinh tế để làm cho nó thêm phần sáng tạo và hài hòa. ${options.decoNotes ? `Làm theo chỉ dẫn cụ thể sau từ người dùng: "${options.decoNotes}"` : ''}`);
    }

    promptParts.push('\n**HƯỚNG DẪN CHI TIẾT:**');
    
    const layoutMapping: { [key: string]: string } = {
        'Bố Cục Flat Lay (Chụp từ trên xuống)': 'Đặt sản phẩm theo bố cục Flat Lay (chụp thẳng từ trên xuống). Sắp xếp sản phẩm và các phụ kiện liên quan một cách nghệ thuật trên một bề mặt phẳng. Mô phỏng hình dáng sản phẩm như đang được mặc.',
        'Bố Cục Ghost Mannequin (Ma-nơ-canh vô hình)': 'Sử dụng kỹ thuật ma-nơ-canh vô hình (ghost mannequin). Sản phẩm phải trông như đang được mặc bởi một người vô hình, thể hiện rõ phom dáng và độ rủ của vải.',
        'Bố Cục Chụp Treo (Hanging Photography)': 'Treo sản phẩm lên một chiếc móc hoặc giá treo tối giản. Thể hiện sự mềm mại và độ rủ của chất liệu. Có thể thêm hiệu ứng chuyển động nhẹ như vải đang bay.',
        'Bố cục Trung tâm & Đối xứng': 'Đặt sản phẩm ở chính giữa khung hình. Áp dụng bố cục đối xứng để tạo cảm giác cân đối, gọn gàng.',
        'Bố cục Không gian âm': 'Đặt sản phẩm lệch khỏi trung tâm (theo Quy tắc 1/3) trên một nền rộng, trống. Tận dụng không gian âm để làm nổi bật sự tinh tế của sản phẩm.',
        'Bố cục Chi tiết (Close-up)': 'Chụp cận cảnh vào một chi tiết đắt giá của sản phẩm (khóa kéo, đường may, logo, chất liệu). Chi tiết này phải lấp đầy phần lớn khung hình.',
        'Bố cục Sắp xếp nhóm (Group Shot)': 'Sắp xếp một nhóm gồm nhiều sản phẩm (hoặc sản phẩm và phụ kiện) theo Quy tắc số lẻ (3 hoặc 5 món). Sử dụng các đường nét để tạo sự dẫn dắt cho mắt người xem.'
    };
    
    const layoutMappingEn: { [key: string]: string } = {
        'Flat Lay Layout (Top-down Shot)': 'Place the product in a Flat Lay layout (shot directly from above). Artfully arrange the product and related accessories on a flat surface. Simulate the product\'s shape as if it were being worn.',
        'Ghost Mannequin Layout': 'Use the ghost mannequin technique. The product must look as if it is being worn by an invisible person, clearly showing the form and drape of the fabric.',
        'Hanging Layout': 'Hang the product on a minimalist hook or rack. Emphasize the softness and drape of the material. A slight motion effect like flowing fabric can be added.',
        'Center & Symmetric Layout': 'Place the product in the exact center of the frame. Apply a symmetrical composition to create a sense of balance and order.',
        'Negative Space Layout': 'Place the product off-center (following the Rule of Thirds) on a large, empty background. Utilize negative space to highlight the product\'s elegance.',
        'Close-up Detail Layout': 'Take a close-up shot of a valuable detail of the product (zipper, stitching, logo, material). This detail should fill most of the frame.',
        'Group Arrangement Layout': 'Arrange a group of multiple products (or a product with accessories) following the Rule of Odds (3 or 5 items). Use lines and shapes to create a visual path for the viewer\'s eye.'
    };

    const layoutInstruction = layoutMapping[options.layout] || layoutMappingEn[options.layout];

    if (layoutInstruction) {
        promptParts.push(`- **Bố cục:** ${layoutInstruction}`);
    } else if (options.layout && options.layout !== 'Tự động' && options.layout !== 'Auto') {
        promptParts.push(`- **Bố cục:** Đặt sản phẩm theo kiểu "${options.layout}".`);
    }

    if (options.shootingStyle && options.shootingStyle !== 'Tự động' && options.shootingStyle !== 'Auto') {
        promptParts.push(`- **Phong cách chụp:** ${options.shootingStyle}.`);
    }

    if (options.productScale && options.productScale !== 'Tự động' && options.productScale !== 'Auto') {
        promptParts.push(`- **Tỷ lệ sản phẩm:** Sản phẩm được ghép vào phải có kích thước tương đối ${options.productScale.toLowerCase()} so với bối cảnh.`);
    }

    if (options.productShadow && options.productShadow.trim() !== '' && !options.productShadow.toLowerCase().includes('tự động')) {
        promptParts.push(`- **Bóng đổ sản phẩm:** ${options.productShadow}.`);
    }

    let lightingInstruction = '';
    switch (options.lightingCategory) {
        case 'natural': lightingInstruction = options.naturalLight || ''; break;
        case 'studio': lightingInstruction = options.studioLight || ''; break;
        case 'style': lightingInstruction = options.styleLight || ''; break;
    }

    if (lightingInstruction && lightingInstruction !== 'Tự động' && lightingInstruction !== 'Auto') {
        promptParts.push(`- **Ánh sáng:** ${lightingInstruction}. Ánh sáng này phải được áp dụng cho toàn bộ cảnh một cách chân thực, bao gồm cả việc tạo bóng đổ và phản chiếu chính xác cho sản phẩm.`);
    }

    const styleMapping: { [key: string]: string } = {
        'Giống 100%': '- **Cảm hứng bối cảnh:** GIỮ NGUYÊN 100% ảnh bối cảnh gốc. Chỉ điều chỉnh ánh sáng và bóng đổ trên sản phẩm để khớp với bối cảnh.',
        'Hòa trộn': '- **Cảm hứng bối cảnh:** GIỮ NGUYÊN bối cảnh gốc nhưng cho phép điều chỉnh nhẹ nhàng ánh sáng và màu sắc của cả cảnh để sản phẩm và nền hòa hợp hơn.',
        'Sáng tạo': '- **Cảm hứng bối cảnh:** Sử dụng ảnh bối cảnh gốc làm CẢM HỨNG để tạo ra một bối cảnh MỚI hoàn toàn, nhưng phải giữ được chủ đề và không khí chung (ví dụ: nếu bối cảnh là bãi biển, có thể tạo ra một bãi biển khác vào thời điểm khác trong ngày).'
    };

    const styleMappingEn: { [key: string]: string } = {
        'Match 100%': '- **Scene Inspiration:** PRESERVE 100% of the original scene image. Only adjust lighting and shadows on the product to match the scene.',
        'Blend': '- **Scene Inspiration:** PRESERVE the original scene but allow for gentle adjustments to the lighting and color of the entire scene to better harmonize the product and background.',
        'Creative': '- **Scene Inspiration:** Use the original scene image as INSPIRATION to create a completely NEW scene, but it must maintain the general theme and atmosphere (e.g., if the scene is a beach, a different beach at a different time of day could be created).'
    };

    promptParts.push(styleMapping[options.sceneStyle] || styleMappingEn[options.sceneStyle] || styleMapping['Hòa trộn']);
    
    promptParts.push('\nKết quả cuối cùng phải là một bức ảnh duy nhất, chất lượng cao. Chỉ trả về ảnh kết quả.');

    const prompt = promptParts.join('\n');
    const textPart = { text: prompt };
    parts.push(textPart);

    try {
        console.log("Attempting to generate replaced product image with prompt...", prompt);
        const response = await callGeminiWithRetry(parts);
        return processGeminiResponse(response);
    } catch (error) {
        const processedError = processApiError(error);
        console.error("Error during product replacement generation:", processedError);
        throw processedError;
    }
}