package expo.modules.styledtext

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import android.text.Editable
import android.text.Spanned
import android.text.TextPaint
import android.text.style.CharacterStyle
import android.text.style.MetricAffectingSpan
import android.text.style.ReplacementSpan
import android.util.TypedValue
import android.widget.EditText
import com.facebook.react.bridge.ReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.views.text.ReactFontManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import kotlinx.coroutines.launch

// Styles the text of a React Native TextInput in place, with Android spans on the text it already holds. Giving the box new styled
// children makes React Native set its whole text again, which flickered and moved the cursor; spans change only how it is drawn.
// JavaScript decides what is styled (the same parser the desktop uses); this applies the ranges it sends.

// Marks the spans this module owns, so the next call can remove exactly those.
// `key` says what the span does, so a new pass can keep the spans that are already right and change only the others.
private interface OwnedSpan { val key: String }

private class FontSpan(private val face: Typeface?, private val sizePx: Float?, override val key: String) : MetricAffectingSpan(), OwnedSpan {
  override fun updateDrawState(paint: TextPaint) = apply(paint)
  override fun updateMeasureState(paint: TextPaint) = apply(paint)
  private fun apply(paint: TextPaint) {
    face?.let { paint.typeface = it }
    sizePx?.let { paint.textSize = it }
  }
}

private class StrikeSpan : CharacterStyle(), OwnedSpan {
  override val key = "S"
  override fun updateDrawState(paint: TextPaint) { paint.isStrikeThruText = true }
}

private class FadeSpan(private val color: Int) : CharacterStyle(), OwnedSpan {
  override val key = "C$color"
  override fun updateDrawState(paint: TextPaint) { paint.color = color }
}

// Takes no room and draws nothing; the characters are still in the text, so the cursor and the stored text stay valid.
private class HiddenSpan : ReplacementSpan(), OwnedSpan {
  override val key = "H"
  override fun getSize(paint: Paint, text: CharSequence?, start: Int, end: Int, fm: Paint.FontMetricsInt?): Int = 0
  override fun draw(canvas: Canvas, text: CharSequence?, start: Int, end: Int, x: Float, top: Int, y: Int, bottom: Int, paint: Paint) {}
}

class Run : Record {
  @Field var start: Int = 0
  @Field var end: Int = 0
  @Field var bold: Boolean = false
  @Field var italic: Boolean = false
  @Field var strike: Boolean = false
  @Field var heading: Int = 0
  @Field var marker: Boolean = false
}

class Look : Record {
  @Field var hideMarks: Boolean = false
  @Field var markColor: Int = 0 // ARGB, already faded
  @Field var boldFamily: String = ""
  @Field var italicFamily: String = ""
  @Field var headingFamily: String = ""
  @Field var h1: Float = 0f // sp
  @Field var h2: Float = 0f
  @Field var h3: Float = 0f
}

class StyledTextModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("StyledText")

    // `length` is the text the runs were made from: if the box has moved on (typed since), skip; the next call carries the new text.
    Function("apply") { viewTag: Int, length: Int, runs: List<Run>, look: Look ->
      val context = appContext.reactContext as? ReactContext ?: return@Function
      appContext.mainQueue.launch {
        val view = UIManagerHelper.getUIManagerForReactTag(context, viewTag)?.resolveView(viewTag) as? EditText ?: return@launch
        val text: Editable = view.text ?: return@launch
        if (text.length != length) return@launch
        val assets = context.assets
        fun face(family: String): Typeface? = if (family.isEmpty()) null else ReactFontManager.getInstance().getTypeface(family, Typeface.NORMAL, assets)
        fun px(sp: Float): Float = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, sp, view.resources.displayMetrics)
        val bold = face(look.boldFamily)
        val italic = face(look.italicFamily)
        val heading = face(look.headingFamily)

        val flags = Spanned.SPAN_EXCLUSIVE_EXCLUSIVE // typed text next to a run does not join it
        // What the text should carry, then only the difference: removing and adding every span on each keystroke made the whole
        // text lay out and draw again (a flash); most keystrokes change no span at all.
        val wanted = LinkedHashMap<String, () -> OwnedSpan>() // "start:end:key" to the span to add
        fun want(start: Int, end: Int, key: String, make: () -> OwnedSpan) { wanted["$start:$end:$key"] = make }
        for (run in runs) {
          if (run.start >= run.end || run.end > text.length) continue
          if (run.marker && look.hideMarks) { want(run.start, run.end, "H") { HiddenSpan() }; continue }
          val size = when (run.heading) { 1 -> look.h1; 2 -> look.h2; 3 -> look.h3; else -> 0f }
          val family = if (run.heading > 0) look.headingFamily else if (run.bold) look.boldFamily else if (run.italic) look.italicFamily else ""
          val face = if (run.heading > 0) heading else if (run.bold) bold else if (run.italic) italic else null
          if (face != null || size > 0f) want(run.start, run.end, "F:$family:$size") { FontSpan(face, if (size > 0f) px(size) else null, "F:$family:$size") }
          if (run.strike) want(run.start, run.end, "S") { StrikeSpan() }
          if (run.marker) want(run.start, run.end, "C${look.markColor}") { FadeSpan(look.markColor) }
        }
        for (old in text.getSpans(0, text.length, OwnedSpan::class.java)) {
          val id = "${text.getSpanStart(old)}:${text.getSpanEnd(old)}:${old.key}"
          if (wanted.remove(id) == null) text.removeSpan(old)
        }
        for ((id, make) in wanted) {
          val (start, end) = id.split(":", limit = 3).let { it[0].toInt() to it[1].toInt() }
          text.setSpan(make(), start, end, flags)
        }
      }
    }
  }
}
