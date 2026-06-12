import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PROMPT_INSTRUCTIONS = `First extract all text from this resume data, then analyze it against the job description. Return ONLY a JSON object with exactly this structure:
{
  "overall_score": <integer 0-100>,
  "section_scores": {
    "skills": <integer 0-100>,
    "experience": <integer 0-100>,
    "education": <integer 0-100>,
    "summary": <integer 0-100>
  },
  "matched_keywords": [ { "keyword": "<word>", "importance": "high|medium|low" } ],
  "missing_keywords": [ { "keyword": "<word>", "importance": "high|medium|low", "why": "<1 sentence>" } ],
  "weak_bullets": [ { "original": "<exact bullet>", "rewritten": "<improved version with metric>" } ],
  "top_3_actions": ["<action 1>", "<action 2>", "<action 3>"]
}

Rules:
- matched_keywords: max 15 items
- missing_keywords: max 10 items
- weak_bullets: max 5 items, rewritten must include a number or metric
- overall_score must reflect realistic ATS match quality`

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { resumeText, resumeFile, jdText } = body

    if (!jdText || (!resumeText && !resumeFile)) {
      return new Response(
        JSON.stringify({ error: 'jdText and one of resumeText/resumeFile are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'LOVABLE_API_KEY is not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Build user message content. If a PDF file is provided, attach it as inline file data
    // so Gemini can extract the text directly from the PDF.
    let userContent: any
    if (resumeFile) {
      const base64Data = (resumeFile as string).split(',')[1] || (resumeFile as string)
      userContent = [
        { type: 'text', text: `${PROMPT_INSTRUCTIONS}\n\nJOB DESCRIPTION:\n${jdText}` },
        {
          type: 'file',
          file: {
            filename: 'resume.pdf',
            file_data: `data:application/pdf;base64,${base64Data}`,
          },
        },
      ]
    } else {
      userContent = `${PROMPT_INSTRUCTIONS}\n\nRESUME:\n${resumeText}\n\nJOB DESCRIPTION:\n${jdText}`
    }

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You are an expert ATS system and resume coach. Always return valid JSON only, no extra text.' },
          { role: 'user', content: userContent },
        ],
      }),
    })

    if (!aiResponse.ok) {
      const errText = await aiResponse.text()
      return new Response(
        JSON.stringify({ error: `AI gateway error: ${aiResponse.status} ${errText}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const aiData = await aiResponse.json()
    const content = aiData.choices?.[0]?.message?.content ?? ''
    let parsed
    try {
      parsed = JSON.parse(content)
    } catch {
      const match = content.match(/\{[\s\S]*\}/)
      if (!match) throw new Error('Model did not return JSON')
      parsed = JSON.parse(match[0])
    }

    return new Response(
      JSON.stringify(parsed),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
