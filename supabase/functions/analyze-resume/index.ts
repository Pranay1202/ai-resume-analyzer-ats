import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { resumeText, jdText } = await req.json()

    if (!resumeText || !jdText) {
      return new Response(
        JSON.stringify({ error: 'resumeText and jdText are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.3,
        max_tokens: 1800,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are an expert ATS system and resume coach. Always return valid JSON only, no extra text.'
          },
          {
            role: 'user',
            content: `Analyze this resume against the job description and return a JSON object with exactly this structure:
{
  "overall_score": <integer 0-100>,
  "section_scores": {
    "skills": <integer 0-100>,
    "experience": <integer 0-100>,
    "education": <integer 0-100>,
    "summary": <integer 0-100>
  },
  "matched_keywords": [
    { "keyword": "<word>", "importance": "high|medium|low" }
  ],
  "missing_keywords": [
    { "keyword": "<word>", "importance": "high|medium|low", "why": "<1 sentence>" }
  ],
  "weak_bullets": [
    { "original": "<exact bullet>", "rewritten": "<improved version with metric>" }
  ],
  "top_3_actions": ["<action 1>", "<action 2>", "<action 3>"]
}

Rules:
- matched_keywords: max 15 items
- missing_keywords: max 10 items, importance "high" = required skill
- weak_bullets: max 5 items, rewritten must include a number or metric
- overall_score must reflect realistic ATS match quality

RESUME:
${resumeText}

JOB DESCRIPTION:
${jdText}`
          }
        ]
      })
    })

    const openaiData = await openaiResponse.json()
    const result = JSON.parse(openaiData.choices[0].message.content)

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
